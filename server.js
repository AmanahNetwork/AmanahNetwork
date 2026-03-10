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
    service: 'gmail',
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
});

// --- 4. PAYTM ROUTES ---

// Step 1: Initiate Payment
app.post('/api/paytm/initiate', async (req, res) => {
    try {
        const { amount, name, aadhar, email } = req.body;
        const orderId = "ORD_" + Date.now();

        // Pre-save donor as pending
        await Donor.create({ name, aadhar, email, amount, orderId, status: 'Pending' });

        const paytmParams = {
            body: {
                "requestType": "Payment",
                "mid": process.env.PAYTM_MID,
                "websiteName": process.env.PAYTM_WEBSITE,
                "orderId": orderId,
                "callbackUrl": process.env.PAYTM_CALLBACK_URL,
                "txnAmount": { "value": amount.toString(), "currency": "INR" },
                "userInfo": { "custId": email },
            }
        };

        const checksum = await PaytmChecksum.generateSignature(JSON.stringify(paytmParams.body), process.env.PAYTM_MKEY);
        paytmParams.head = { "signature": checksum };

        const post_data = JSON.stringify(paytmParams);
        const options = {
            hostname: 'securegw-stage.paytm.in', // Use 'securegw.paytm.in' for production
            port: 443,
            path: `/theia/api/v1/initiateTransaction?mid=${process.env.PAYTM_MID}&orderId=${orderId}`,
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': post_data.length }
        };

        let response = "";
        const post_req = https.request(options, (post_res) => {
            post_res.on('data', (chunk) => response += chunk);
            post_res.on('end', () => {
                const result = JSON.parse(response);
                res.json({ token: result.body.txnToken, orderId, mid: process.env.PAYTM_MID });
            });
        });

        post_req.write(post_data);
        post_req.end();
    } catch (err) { res.status(500).send("Initiation Failed"); }
});

// Step 2: Handle Paytm Response
app.post('/api/paytm/callback', async (req, res) => {
    const paytmData = req.body;
    const checksum = paytmData.CHECKSUMHASH;
    delete paytmData.CHECKSUMHASH;

    const isValid = PaytmChecksum.verifySignature(paytmData, process.env.PAYTM_MKEY, checksum);

    if (isValid && paytmData.STATUS === 'TXN_SUCCESS') {
        const updatedDonor = await Donor.findOneAndUpdate(
            { orderId: paytmData.ORDERID },
            { status: 'Success', paymentId: paytmData.TXNID },
            { new: true }
        );

        // Send Confirmation Email
        transporter.sendMail({
            from: `"AmanahNetwork" <${process.env.EMAIL_USER}>`,
            to: updatedDonor.email,
            subject: 'Amanah Received: Success',
            html: `<h2>Trust Confirmed, ${updatedDonor.name}</h2><p>₹${updatedDonor.amount} received.</p>`
        });

        res.redirect('/donors.html'); // Redirect to Wall of Honor
    } else {
        await Donor.findOneAndUpdate({ orderId: paytmData.ORDERID }, { status: 'Failed' });
        res.send("Payment Failed. Please try again.");
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
