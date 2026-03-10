// Handle Donation Form with Paytm Integration
document.getElementById('donationForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const donorData = {
        name: document.getElementById('name').value,
        aadhar: document.getElementById('aadhar').value,
        email: document.getElementById('email').value,
        amount: document.getElementById('amount').value
    };

    try {
        // 1. Get Transaction Token from Backend
        const res = await fetch('/api/paytm/initiate', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(donorData)
        });
        const data = await res.json();

        // 2. Configure Paytm JS
        const config = {
            "root": "",
            "flow": "DEFAULT",
            "data": {
                "orderId": data.orderId,
                "token": data.token,
                "tokenType": "TXN_TOKEN",
                "amount": donorData.amount
            },
            "handler": {
                "notifyMerchant": (eventName, data) => {
                    console.log("Paytm Event:", eventName, data);
                }
            }
        };

        // 3. Open Paytm Checkout
        if (window.Paytm && window.Paytm.CheckoutJS) {
            window.Paytm.CheckoutJS.init(config).then(() => {
                window.Paytm.CheckoutJS.invoke();
            }).catch(err => console.error("CheckoutJS Error:", err));
        }
    } catch (err) {
        console.error("Initiation failed", err);
        alert("Could not connect to Paytm. Please check your internet.");
    }
});

// Load Donors & Animated Stats (Success only)
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
            <div><span class="blurred-info">${d.name}</span></div>
            <div style="font-size: 1.2rem; font-weight: bold; color: var(--teal);">
                <span class="blurred-info">₹${d.amount.toLocaleString()}</span>
            </div>
            <div style="font-size: 0.75rem; color: var(--text-dim); margin-top: 15px;">
                ${new Date(d.date).toLocaleDateString('en-IN')}
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
