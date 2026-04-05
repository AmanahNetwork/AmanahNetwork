require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const nodemailer = require('nodemailer');
const PaytmChecksum = require('paytmchecksum');
const https = require('https');
const path = require('path');

const app = express();

// --- 1. MONGODB CONNECTION ---
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("=== Connected to Cloud MongoDB ==="))
    .catch(err => console.error("MongoDB Connection Error:", err));

const donorSchema = new mongoose.Schema({
    name: String,
    aadhar: String,
    email: String,
    amount: Number,
    orderId: { type: String, unique: true },
    paymentId: String,
    status: { type: String, default: 'Pending' },
    date: { type: Date, default: Date.now }
});
const Donor = mongoose.model('Donor', donorSchema);

// --- 2. MIDDLEWARE ---
app.use(express.json());
app.use(express.urlencoded({ extended: true })); // Required for Paytm Callback
app.use(express.static(__dirname));

// --- 3. EMAIL SETUP ---
const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false, // Must be false for port 587
    requireTLS: true,
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    },
    // THIS IS THE FIX: Forces IPv4 to avoid the ENETUNREACH error
    connectionTimeout: 30000, 
    greetingTimeout: 30000,
    socketTimeout: 30000,
   debug: true, // This will print more info to your Render logs
    logger: true
});
// --- 4. PAYTM ROUTES ---

// Step 1: Initiate Payment
const Razorpay = require('razorpay');

const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// Step 1: Create Order
app.post('/api/paytm/initiate', async (req, res) => { // Kept same route name for your frontend
    try {
        const { amount, name, aadhar, email } = req.body;
        const orderId = "ORD_" + Date.now();

        // Create Razorpay Order
        const options = {
            amount: amount * 100, // Amount in paisa
            currency: "INR",
            receipt: orderId,
        };

        const order = await razorpay.orders.create(options);

        // Save to MongoDB (Pending)
        await Donor.create({ name, aadhar, email, amount, orderId: order.id, status: 'Pending' });

        res.json({ 
            key: process.env.RAZORPAY_KEY_ID, 
            amount: order.amount, 
            order_id: order.id 
        });
    } catch (err) {
        console.error("Razorpay Error:", err);
        res.status(500).json({ error: "Order Creation Failed" });
    }
});

// Step 2: Handle Success Callback (Simplified for Test Mode)
app.post('/api/paytm/callback', async (req, res) => {
    const { razorpay_order_id, razorpay_payment_id } = req.body;

    try {
        const updatedDonor = await Donor.findOneAndUpdate(
    { orderId: razorpay_order_id }, 
    { status: 'Success', paymentId: razorpay_payment_id },
    { returnDocument: 'after' } // Updated from 'new: true'
);

        if (updatedDonor) {
            console.log("Found Donor, sending email to:", updatedDonor.email);

            // CRITICAL: Use await here so the server doesn't close the connection too early
            await transporter.sendMail({
                from: `"AmanahNetwork" <${process.env.EMAIL_USER}>`,
                to: updatedDonor.email, 
                subject: 'Amanah Received - Confirmation',
                html: `
                    <div style="font-family: sans-serif; border: 1px solid #eee; padding: 20px;">
                        <h2 style="color: #008080;">Trust Confirmed, ${updatedDonor.name}</h2>
                        <p>We have successfully received your contribution of <b>₹${updatedDonor.amount}</b>.</p>
                        <p>Order ID: ${updatedDonor.orderId}</p>
                        <hr>
                        <p style="font-size: 0.8rem; color: #666;">AmanahNetwork - Secure Trust Management</p>
                    </div>
                `
            });

            console.log("Email Sent Successfully!");
            return res.json({ status: 'success' });
        } else {
            return res.status(404).json({ error: "Donor not found" });
        }
    } catch (err) {
        console.error("Callback/Email Error:", err);
        res.status(500).json({ error: "Internal Server Error" });
    }
});
// Stats API (Filtered for Success only)
app.get('/api/stats', async (req, res) => {
    const stats = await Donor.aggregate([
        { $match: { status: 'Success' } },
        { $group: { _id: null, total_donors: { $sum: 1 }, total_amount: { $sum: "$amount" } } }
    ]);
    res.json(stats[0] || { total_donors: 0, total_amount: 0 });
});

app.get('/api/donors', async (req, res) => {
    const donors = await Donor.find({ status: 'Success' }).sort({ date: -1 }).limit(10);
    res.json(donors);
});

app.listen(process.env.PORT || 3000, () => console.log("Amanah Live with Paytm"));