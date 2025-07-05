import { headers } from 'next/headers'
import { NextResponse } from 'next/server'
import { stripe } from '../../../../lib/stripe'
import clientPromise from '../../../../lib/mongodb'

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET

export async function POST(req) {
  const body = await req.text()
  const signature = headers().get('stripe-signature')

  let event

  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret)
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message)
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  const client = await clientPromise
  const db = client.db()

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object
        
        // Update user subscription status
        await db.collection('users').updateOne(
          { email: session.customer_email },
          {
            $set: {
              stripeCustomerId: session.customer,
              subscriptionStatus: 'active',
              subscriptionId: session.subscription,
              updatedAt: new Date(),
            },
          }
        )
        break
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object
        
        await db.collection('users').updateOne(
          { stripeCustomerId: subscription.customer },
          {
            $set: {
              subscriptionStatus: subscription.status,
              updatedAt: new Date(),
            },
          }
        )
        break
      }

      case 'customer.subscription.deleted': {
        const deletedSubscription = event.data.object
        
        await db.collection('users').updateOne(
          { stripeCustomerId: deletedSubscription.customer },
          {
            $set: {
              subscriptionStatus: 'canceled',
              updatedAt: new Date(),
            },
          }
        )
        break
      }

      default:
        console.log(`Unhandled event type: ${event.type}`)
    }

    return NextResponse.json({ received: true })
  } catch (error) {
    console.error('Error processing webhook:', error)
    return NextResponse.json(
      { error: 'Webhook processing failed' },
      { status: 500 }
    )
  }
}