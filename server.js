require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const Razorpay = require('razorpay');
const SibApiV3Sdk = require('@getbrevo/brevo');
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

// --- 3. BREVO API SETUP (FIXED VERSION) ---
const apiInstance = new SibApiV3Sdk.TransactionalEmailsApi();
// Correct way to set API Key in @getbrevo/brevo v2.x+
apiInstance.setApiKey(SibApiV3Sdk.TransactionalEmailsApiApiKeys.apiKey, process.env.BREVO_API_KEY);

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
            console.log("Payment Success. Sending Email via Brevo API...");

            const sendSmtpEmail = new SibApiV3Sdk.SendSmtpEmail();
            sendSmtpEmail.subject = "Amanah Received - Confirmation";
            sendSmtpEmail.sender = { "name": "AmanahNetwork", "email": process.env.EMAIL_USER };
            sendSmtpEmail.to = [{ "email": updatedDonor.email, "name": updatedDonor.name }];
            sendSmtpEmail.htmlContent = `
                <div style="font-family: sans-serif; border: 1px solid #eee; padding: 20px; max-width: 600px;">
                    <h2 style="color: #008080;">Trust Confirmed, ${updatedDonor.name}</h2>
                    <p>We have successfully received your contribution of <b>₹${updatedDonor.amount}</b>.</p>
                    <p><b>Order ID:</b> ${updatedDonor.orderId}<br>
                    <b>Payment ID:</b> ${updatedDonor.paymentId}</p>
                    <hr>
                    <p style="font-size: 0.8rem; color: #666;">This is an automated receipt from AmanahNetwork.</p>
                </div>`;

            try {
                await apiInstance.sendTransacEmail(sendSmtpEmail);
                console.log("Email Sent Successfully via API!");
                return res.json({ status: 'success' });
            } catch (apiError) {
                console.error("Brevo API Error:", apiError.response ? apiError.response.body : apiError);
                return res.json({ status: 'success', note: 'Email delayed' });
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

app.listen(process.env.PORT || 3000, () => console.log("Amanah Live with Razorpay & Brevo API"));