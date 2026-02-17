  import express from "express";
  import Tips from "../model/tips.js"
  import Razorpay from 'razorpay'
  import crypto from "crypto";
  import { broadcastTip } from "../websocket.js";


  const router = express.Router();

  const razorpayInstance = new Razorpay({
    key_id: process.env.RAZOR_KEY_ID,
    key_secret: process.env.RAZOR_SECRET_KEY
})

  router.post("/verifyRazorpay", async (req, res) => {
  const {
    razorpay_order_id,
    razorpay_payment_id,
    razorpay_signature
  } = req.body;

  try {
    const sign = razorpay_order_id + "|" + razorpay_payment_id;

    const expectedSignature = crypto
      .createHmac("sha256", process.env.RAZOR_SECRET_KEY)
      .update(sign)
      .digest("hex");

    if (expectedSignature !== razorpay_signature) {
      return res.status(400).json({ message: "Invalid signature" });
    }

    // Signature valid → payment is real
    const order = await razorpayInstance.orders.fetch(razorpay_order_id);

    await Tips.findByIdAndUpdate(order.receipt, { payment: true });

    const tip = await Tips.findById(order.receipt);

    const donation = {
      user: tip.name,
      amount: tip.amount,
      message: tip.message
    };

    broadcastTip(donation);

    return res.status(201).json({ message: "Payment verified" });

  } catch (error) {
    console.error("Verification error:", error);
    return res.status(500).json({ message: error.message });
  }
});


  router.post("/razorpay", async (req, res) => {
  const channelName = "Berry";
  const { name, amount, message , currency } = req.body;

  if (!name || !amount) {
    return res.status(400).json({ error: "Invalid donation data" });
  }

  try {
    const newTip = new Tips({
      name,
      amount,
      message,
      channelName,
      payment: false
    });

    await newTip.save();

    const options = {
      amount: amount * 100,
      currency,
      receipt: newTip._id.toString()
    };

    const order = await razorpayInstance.orders.create(options);

    return res.status(201).json(order);

  } catch (error) {
    console.error("Error placing order:", error);
    return res.status(500).json({ message: error.message });
  }
});

router.get('/getTips' , async(req,res) =>{
  const twelveHoursAgo = new Date(Date.now() - 12 * 60 * 60 * 1000);
  try {
    const tips = await Tips.find({
  createdAt: { $gte: twelveHoursAgo }
}).sort({ createdAt: -1 });
    console.log(tips)
    res.status(200).json(tips);
  } catch (error) {
      console.log(error.message)
      res.status(400).json(error)
  }
})

  export default router;
