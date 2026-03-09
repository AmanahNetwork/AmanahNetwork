// Handle Donation Form with Razorpay Integration
document.getElementById('donationForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const donorData = {
        name: document.getElementById('name').value,
        aadhar: document.getElementById('aadhar').value,
        email: document.getElementById('email').value,
        amount: document.getElementById('amount').value,
        phone: document.getElementById('phone')?.value || 'N/A'
    };

    try {
        // Step 1: Create Order on Backend
        const orderRes = await fetch('/create-order', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ amount: donorData.amount })
        });
        const order = await orderRes.json();

        // Step 2: Open Razorpay Checkout
        const options = {
            "key": "rzp_test_YOUR_KEY_ID", // REPLACE WITH YOUR RAZORPAY KEY ID
            "amount": order.amount,
            "currency": "INR",
            "name": "Amanah Network",
            "description": "Donation for Relief",
            "order_id": order.id,
            "handler": async function (response) {
                // Step 3: Payment Success -> Finalize on Backend
                const verifyRes = await fetch('/verify-payment', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({
                        razorpay_payment_id: response.razorpay_payment_id,
                        donorData: donorData
                    })
                });

                if (verifyRes.ok) {
                    alert("Amanah Fulfilled! Confirmation sent to: " + donorData.email);
                    location.reload();
                }
            },
            "theme": {"color": "#f59e0b"}
        };

        const rzp1 = new Razorpay(options);
        rzp1.open();
    } catch (err) {
        console.error("Payment failed", err);
        alert("Transaction could not be initialized.");
    }
});

// Load Donors & Animated Stats (Kept identical to your original)
async function init() {
    const list = document.getElementById('donorList');
    if (!list) return;

    const [donorsRes, statsRes] = await Promise.all([fetch('/api/donors'), fetch('/api/stats')]);
    const donors = await donorsRes.json();
    const stats = await statsRes.json();

    animateValue("donorCount", 0, stats.total_donors || 0, 1500);
    animateValue("totalAmount", 0, stats.total_amount || 0, 1500, "₹");

    list.innerHTML = donors.map(d => `
        <div class="glass-card" style="padding: 25px; border-left: 4px solid var(--gold);">
            <div style="margin-bottom:10px;">
                <span class="blurred-info">${d.name}</span>
            </div>
            <div style="font-size: 1.2rem; font-weight: bold; color: var(--teal);">
                <span class="blurred-info">₹${d.amount.toLocaleString()}</span>
            </div>
            <div style="font-size: 0.75rem; color: var(--text-dim); margin-top: 15px;">
                ${new Date(d.date).toLocaleDateString('en-IN', {day: 'numeric', month: 'short', year: 'numeric'})}
            </div>
        </div>
    `).join('');
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