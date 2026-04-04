// Handle Donation Form with Razorpay Integration
document.getElementById('donationForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const donorData = {
        name: document.getElementById('name').value,
        aadhar: document.getElementById('aadhar').value,
        email: document.getElementById('email').value,
        amount: document.getElementById('amount').value
    };

    try {
        // 1. Get Order Details from Backend
        // We keep the same endpoint name to match your current server setup
        const res = await fetch('/api/paytm/initiate', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(donorData)
        });

        if (!res.ok) throw new Error("Server failed to initiate order");
        
        const data = await res.json();

        // 2. Configure Razorpay Options
        const options = {
            "key": data.key, // Your Razorpay Test Key from Render Env
            "amount": data.amount, // Amount in paisa (sent by backend)
            "currency": "INR",
            "name": "AmanahNetwork",
            "description": "Donation for Trust",
            "order_id": data.order_id, // Order ID created by Razorpay on backend
            "handler": async function (response) {
                // This function runs AFTER a successful payment
                try {
                    const verifyRes = await fetch('/api/paytm/callback', {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({
                            razorpay_payment_id: response.razorpay_payment_id,
                            razorpay_order_id: response.razorpay_order_id,
                            razorpay_signature: response.razorpay_signature
                        })
                    });

                    if (verifyRes.ok) {
                        window.location.href = "/donors.html";
                    } else {
                        alert("Payment verification failed. Please contact support.");
                    }
                } catch (err) {
                    console.error("Verification Error:", err);
                }
            },
            "prefill": {
                "name": donorData.name,
                "email": donorData.email
            },
            "theme": {
                "color": "#008080" // Matches your Teal theme
            }
        };

        // 3. Open Razorpay Checkout
        const rzp1 = new Razorpay(options);
        rzp1.on('payment.failed', function (response){
            alert("Payment Failed: " + response.error.description);
        });
        rzp1.open();

    } catch (err) {
        console.error("Initiation failed", err);
        alert("Could not connect to Payment Gateway. Please check your internet.");
    }
});

// Load Donors & Animated Stats (Remains the same)
async function init() {
    const list = document.getElementById('donorList');
    if (!list) return;

    try {
        const [donorsRes, statsRes] = await Promise.all([
            fetch('/api/donors'), 
            fetch('/api/stats')
        ]);
        
        const donors = await donorsRes.json();
        const stats = await statsRes.json();

        animateValue("donorCount", 0, stats.total_donors || 0, 1500);
        animateValue("totalAmount", 0, stats.total_amount || 0, 1500, "₹");

        list.innerHTML = donors.map(d => `
            <div class="glass-card" style="padding: 25px; border-left: 4px solid var(--gold);">
                <div><span class="blurred-info">${d.name}</span></div>
                <div style="font-size: 1.2rem; font-weight: bold; color: var(--teal);">
                    <span class="blurred-info">₹${Number(d.amount).toLocaleString()}</span>
                </div>
                <div style="font-size: 0.75rem; color: var(--text-dim); margin-top: 15px;">
                    ${new Date(d.date).toLocaleDateString('en-IN')}
                </div>
            </div>
        `).join('');
    } catch (err) {
        console.error("Failed to load donor data:", err);
    }
}

function animateValue(id, start, end, duration, prefix = "") {
    const obj = document.getElementById(id);
    if (!obj) return;
    let startTimestamp = null;
    const step = (timestamp) => {
        if (!startTimestamp) startTimestamp = timestamp;
        const progress = Math.min((timestamp - startTimestamp) / duration, 1);
        obj.innerHTML = prefix + Math.floor(progress * (end - start) + start).toLocaleString();
        if (progress < 1) window.requestAnimationFrame(step);
    };
    window.requestAnimationFrame(step);
}

window.onload = init;