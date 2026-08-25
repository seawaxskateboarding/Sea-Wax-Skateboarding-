// Netlify serverless function: create-checkout
// Takes a cart (array of {name, price, quantity}) and creates ONE real
// Square order + payment link covering everything in the cart, including
// a flat shipping line item. Returns { url } for the client to redirect to.

const SQUARE_LOCATION_ID = "LWYNEFXKHG703";
const SHIPPING_FLAT_RATE_CENTS = 500; // $5.00 flat shipping — change this number to adjust the rate

exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  let cart;
  try {
    const body = JSON.parse(event.body);
    cart = body.cart;
    if (!Array.isArray(cart) || cart.length === 0) {
      throw new Error("Cart is empty");
    }
  } catch (err) {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid cart data" }) };
  }

  const accessToken = process.env.SQUARE_ACCESS_TOKEN;
  if (!accessToken) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Server is missing SQUARE_ACCESS_TOKEN configuration" }),
    };
  }

  // Build line items from the cart
  const lineItems = cart.map((item) => ({
    name: String(item.name).slice(0, 512),
    quantity: String(item.quantity || 1),
    base_price_money: {
      amount: Math.round(Number(item.price) * 100),
      currency: "USD",
    },
  }));

  // Add flat shipping as its own visible line item
  lineItems.push({
    name: "Shipping",
    quantity: "1",
    base_price_money: {
      amount: SHIPPING_FLAT_RATE_CENTS,
      currency: "USD",
    },
  });

  const idempotencyKey =
    "cart-" + Date.now() + "-" + Math.random().toString(36).slice(2, 10);

  try {
    const response = await fetch(
      "https://connect.squareup.com/v2/online-checkout/payment-links",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + accessToken,
          "Square-Version": "2025-01-23",
        },
        body: JSON.stringify({
          idempotency_key: idempotencyKey,
          order: {
            location_id: SQUARE_LOCATION_ID,
            line_items: lineItems,
          },
        }),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return {
        statusCode: response.status,
        body: JSON.stringify({ error: data.errors || "Square API error" }),
      };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ url: data.payment_link.url }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Failed to reach Square: " + err.message }),
    };
  }
};
