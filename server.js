require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const Razorpay = require('razorpay');
const nodemailer = require('nodemailer');
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
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname));

// --- 3. GMAIL NODEMAILER SETUP ---
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS // 16-character App Password (NO SPACES)
    },
    // Adding extra timeout for Render's network latency
    connectionTimeout: 10000, 
    socketTimeout: 10000
});

// Verify connection configuration
transporter.verify((error, success) => {
    if (error) {
        console.log("Email Config Error:", error);
    } else {
        console.log("Gmail Server is ready to send messages");
    }
});

// --- 4. RAZORPAY SETUP ---
const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// --- 5. ROUTES ---

app.post('/api/paytm/initiate', async (req, res) => {
    try {
        const { amount, name, aadhar, email } = req.body;
        const options = {
            amount: amount * 100, 
            currency: "INR",
            receipt: "ORD_" + Date.now(),
        };
        const order = await razorpay.orders.create(options);
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

app.post('/api/paytm/callback', async (req, res) => {
    const { razorpay_order_id, razorpay_payment_id } = req.body;
    try {
        const updatedDonor = await Donor.findOneAndUpdate(
            { orderId: razorpay_order_id }, 
            { status: 'Success', paymentId: razorpay_payment_id },
            { returnDocument: 'after' }
        );

        if (updatedDonor) {
            console.log("Payment Success. Sending Gmail to:", updatedDonor.email);

            const mailOptions = {
                from: `"AmanahNetwork" <${process.env.EMAIL_USER}>`,
                to: updatedDonor.email,
                subject: 'Amanah Received - Confirmation',
                html: `
                    <div style="font-family: sans-serif; border: 1px solid #eee; padding: 20px; max-width: 600px;">
                        <h2 style="color: #008080;">Trust Confirmed, ${updatedDonor.name}</h2>
                        <p>We have successfully received your contribution of <b>₹${updatedDonor.amount}</b>.</p>
                        <p><b>Order ID:</b> ${updatedDonor.orderId}<br>
                        <b>Payment ID:</b> ${updatedDonor.paymentId}</p>
                        <hr>
                        <p style="font-size: 0.8rem; color: #666;">AmanahNetwork - Secure Trust Management</p>
                    </div>`
            };

            // Using async/await for Nodemailer
            try {
                await transporter.sendMail(mailOptions);
                console.log("Email Sent Successfully!");
                return res.json({ status: 'success' });
            } catch (mailError) {
                console.error("Nodemailer Error:", mailError);
                // Return success anyway so the UI updates, as payment was successful
                return res.json({ status: 'success', note: 'Email failed' });
            }
        } else {
            return res.status(404).json({ error: "Donor not found" });
        }
    } catch (err) {
        console.error("Callback Error:", err);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

// --- STATS & DONORS ---
app.get('/api/stats', async (req, res) => {
    try {
        const stats = await Donor.aggregate([
            { $match: { status: 'Success' } },
            { $group: { _id: null, total_donors: { $sum: 1 }, total_amount: { $sum: "$amount" } } }
        ]);
        res.json(stats[0] || { total_donors: 0, total_amount: 0 });
    } catch (err) {
        res.status(500).json({ error: "Stats failed" });
    }
});

app.get('/api/donors', async (req, res) => {
    try {
        const donors = await Donor.find({ status: 'Success' }).sort({ date: -1 }).limit(10);
        res.json(donors);
    } catch (err) {
        res.status(500).json({ error: "Donor list failed" });
    }
});

app.listen(process.env.PORT || 3000, () => console.log("Amanah Live with Razorpay & Gmail"));