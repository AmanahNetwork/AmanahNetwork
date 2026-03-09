require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const nodemailer = require('nodemailer');
const Razorpay = require('razorpay');
const path = require('path');

const app = express();

// --- 1. MONGODB CLOUD CONNECTION ---
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("=== Connected to Cloud MongoDB ==="))
    .catch(err => console.error("MongoDB Connection Error:", err));

// Define Donor Schema
const donorSchema = new mongoose.Schema({
    name: String,
    aadhar: String,
    phone: String,
    email: String,
    amount: Number,
    payment_id: String,
    date: { type: Date, default: Date.now }
});
const Donor = mongoose.model('Donor', donorSchema);

// --- 2. MIDDLEWARE & RAZORPAY ---
app.use(bodyParser.json());
app.use(express.static(__dirname));

const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET
});

// --- 3. EMAIL SETUP ---
const transporter = nodemailer.createTransport({
    service: 'gmail',
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
    tls: { rejectUnauthorized: false }
});

// --- 4. ROUTES ---

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

app.post('/create-order', async (req, res) => {
    try {
        const order = await razorpay.orders.create({
            amount: req.body.amount * 100,
            currency: "INR",
            receipt: "rcpt_" + Date.now()
        });
        res.json(order);
    } catch (error) { res.status(500).json(error); }
});

app.post('/verify-payment', async (req, res) => {
    const { donorData, razorpay_payment_id } = req.body;
    try {
        // Save to MongoDB
        const newDonor = new Donor({ ...donorData, payment_id: razorpay_payment_id });
        const savedDonor = await newDonor.save();

        // Send Styled Email
        const mailOptions = {
            from: `"AmanahNetwork" <${process.env.EMAIL_USER}>`,
            to: donorData.email,
            cc: process.env.EMAIL_USER,
            subject: 'Amanah Received: Your Trust, Their Survival',
            html: `<div style="font-family:sans-serif; background:#0f172a; color:white; padding:40px; border-radius:10px;">
                    <h2 style="color:#f59e0b;">Trust Confirmed, ${donorData.name}</h2>
                    <p>Your contribution of <b>₹${donorData.amount}</b> was successful.</p>
                    <hr style="border:0; border-top:1px solid #1e293b;">
                    <p style="font-size:12px; color:#94a3b8;">Payment ID: ${razorpay_payment_id} | Ref: ${savedDonor._id}</p>
                   </div>`
        };
        transporter.sendMail(mailOptions);
        res.json({ status: 'success' });
    } catch (err) { res.status(500).json({ error: "Cloud Save Failed" }); }
});

app.get('/api/stats', async (req, res) => {
    try {
        const stats = await Donor.aggregate([
            { $group: { _id: null, total_donors: { $sum: 1 }, total_amount: { $sum: "$amount" } } }
        ]);
        res.json(stats[0] || { total_donors: 0, total_amount: 0 });
    } catch (err) { res.status(500).json(err); }
});

app.get('/api/donors', async (req, res) => {
    try {
        const donors = await Donor.find().sort({ date: -1 }).limit(10);
        res.json(donors);
    } catch (err) { res.status(500).json(err); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Amanah Live: http://localhost:${PORT}`));