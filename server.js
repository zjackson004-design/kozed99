const express = require('express');
const axios = require('axios');
const cors = require('cors');
const mongoose = require('mongoose');
const path = require('path');
const bcrypt = require('bcryptjs');

const app = express();
app.use(cors());
app.use(express.json());

// ✅ 1. DATABASE CONNECTION
const MONGO_URI = "mongodb+srv://kozed:Bwargyi69@cluster0.s5oybom.mongodb.net/z99_final?appName=Cluster0";
// ✅ YOUR NEW REAL API KEY
const ODDS_API_KEY = "36a3572a718ac9c39b292c2a5de34221"; 
const ADMIN_SECRET = "Z99-BOSS";

mongoose.connect(MONGO_URI)
    .then(() => console.log("✅ MongoDB Connected!"))
    .catch(err => console.error("❌ MongoDB Error:", err));

// ✅ 2. SCHEMAS
const configSchema = new mongoose.Schema({ key: { type: String, unique: true }, value: String });
const Config = mongoose.model('Config', configSchema);

const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    balance: { type: Number, default: 0 },
    isBanned: { type: Boolean, default: false },
    history: { type: Array, default: [] }, 
    transactions: { type: Array, default: [] }
});
const User = mongoose.model('User', userSchema);

const requestSchema = new mongoose.Schema({
    username: { type: String, required: true },
    type: { type: String, required: true },
    amount: { type: Number, required: true },
    method: { type: String, default: "Kpay" },
    paymentId: { type: String, default: "-" },
    accountName: { type: String, default: "-" },
    status: { type: String, default: "Pending" },
    date: { type: String, default: () => new Date().toLocaleString() }
});
const Request = mongoose.model('Request', requestSchema);

const adminLogSchema = new mongoose.Schema({
    action: String, admin: String, details: String, date: { type: String, default: () => new Date().toLocaleString() }
});
const AdminLog = mongoose.model('AdminLog', adminLogSchema);

// ✅ 3. MIDDLEWARE
app.use(express.static(__dirname));

app.use(async (req, res, next) => {
    if (req.path.startsWith('/admin') || req.path === '/auth/login' || req.path === '/auth/register' || req.path.includes('.')) return next();
    const maint = await Config.findOne({ key: 'maintenance' });
    if (maint && maint.value === 'true') return res.status(503).json({ error: "⚠️ SITE UNDER MAINTENANCE" });
    next();
});

// ✅ 4. AUTH ROUTES
app.post('/auth/register', async (req, res) => {
    const { username, password, inviteCode } = req.body;
    try {
        const codeDoc = await Config.findOne({ key: 'invite_code' });
        const VALID_CODE = codeDoc ? codeDoc.value : "8888"; 
        if (inviteCode !== VALID_CODE) return res.status(400).json({ error: "Invalid Invite Code!" });
        const existing = await User.findOne({ username });
        if(existing) return res.status(400).json({ error: "Username taken!" });
        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = new User({ username, password: hashedPassword, balance: 0 });
        await newUser.save();
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/auth/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const user = await User.findOne({ username });
        if(!user) return res.status(400).json({ error: "User not found" });
        if(user.isBanned) return res.status(403).json({ error: "BANNED" });
        const isMatch = await bcrypt.compare(password, user.password);
        if(!isMatch) return res.status(400).json({ error: "Wrong password" });
        res.json({ success: true, user: { username: user.username, balance: user.balance } });
    } catch (err) { res.status(500).json({ error: "Error" }); }
});

// ✅ 5. USER ROUTES
app.post('/user/request', async (req, res) => {
    const { username, type, amount, method, paymentId, accountName } = req.body;
    try {
        const user = await User.findOne({ username });
        if (!user) return res.status(404).json({ error: "User not found" });
        if (type === 'Withdraw') {
            if (user.balance < amount) return res.status(400).json({ error: "Insufficient Balance" });
            user.balance -= amount; await user.save();
        }
        const newReq = new Request({ username, type, amount, method, paymentId, accountName });
        await newReq.save();
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: "Request Failed" }); }
});

app.post('/user/sync', async (req, res) => { 
    const { username } = req.body; 
    try { const user = await User.findOne({ username }); if(!user) return res.status(404).json({ error: "User not found" }); res.json(user); } catch (err) { res.status(500).json({ error: "Error" }); } 
});
app.get('/user/my-requests', async (req, res) => { 
    const { username } = req.query; 
    try { const requests = await Request.find({ username }).sort({ _id: -1 }).limit(50); res.json(requests); } catch (err) { res.status(500).json([]); } 
});
app.post('/user/bet', async (req, res) => { 
    const { username, stake, ticket } = req.body; 
    try { 
        const user = await User.findOne({ username }); 
        if (!user || user.balance < stake) return res.status(400).json({ error: "Insufficient Balance" }); 
        const limitStakeDoc = await Config.findOne({ key: 'max_stake' }); 
        const limitWinDoc = await Config.findOne({ key: 'max_win' }); 
        const MAX_STAKE = limitStakeDoc ? parseInt(limitStakeDoc.value) : 100000; 
        const MAX_WIN = limitWinDoc ? parseInt(limitWinDoc.value) : 5000000; 
        let totalOdds = 1; 
        if(ticket.matches && Array.isArray(ticket.matches)) { ticket.matches.forEach(m => totalOdds *= parseFloat(m.odds)); } 
        const calculatedWin = Math.floor(stake * totalOdds); 
        ticket.win = calculatedWin.toLocaleString() + " MMK"; 
        if (stake > MAX_STAKE) return res.status(400).json({ error: `Stake Limit: ${MAX_STAKE}` }); 
        if (calculatedWin > MAX_WIN) return res.status(400).json({ error: `Payout Limit: ${MAX_WIN}` }); 
        user.balance -= stake; user.history.unshift(ticket); user.transactions.unshift({ title: "Bet Placed", date: new Date().toLocaleString(), amount: `-${stake}`, status: "Success", color: "red" }); user.markModified('history'); await user.save(); res.json({ success: true, newBalance: user.balance, history: user.history }); 
    } catch (err) { res.status(500).json({ error: err.message }); } 
});

// ✅ 6. ADMIN ROUTES (Shortened for brevity but fully functional)
app.post('/admin/login', (req, res) => { const { code } = req.body; if (code === ADMIN_SECRET) res.json({ success: true }); else res.json({ success: false }); });
app.get('/admin/data', async (req, res) => { try { const users = await User.find({}); const dbMap = {}; users.forEach(u => { dbMap[u.username] = { id: u._id, balance: u.balance, history: u.history, transactions: u.transactions, password: u.password, isBanned: u.isBanned }; }); res.json(dbMap); } catch (err) { res.status(500).json({ error: "DB Error" }); } });
app.get('/admin/requests', async (req, res) => { try { const requests = await Request.find({ status: 'Pending' }); res.json(requests); } catch(e) { res.json([]); } });
app.get('/admin/transactions', async (req, res) => { try { const users = await User.find({}); let allTrx = []; users.forEach(u => { u.transactions.forEach(t => { allTrx.push({ ...t, username: u.username }); }); }); allTrx.sort((a, b) => new Date(b.date) - new Date(a.date)); res.json(allTrx.slice(0, 100)); } catch (e) { res.json([]); } });
app.post('/admin/approve-request', async (req, res) => { const { id, action } = req.body; try { const reqDoc = await Request.findById(id); if(!reqDoc || reqDoc.status !== 'Pending') return res.status(400).json({ error: "Invalid" }); reqDoc.status = action; await reqDoc.save(); const user = await User.findOne({ username: reqDoc.username }); if(user) { const details = `${reqDoc.method} | ${reqDoc.paymentId}`; if (action === 'Approve') { if (reqDoc.type === 'Deposit') { user.balance += reqDoc.amount; user.transactions.unshift({ title: "Deposit Approved", type: "Deposit", details: details, date: new Date().toLocaleString(), amount: `+${reqDoc.amount}`, status: "Success", color: "green" }); } else { user.transactions.unshift({ title: "Withdraw Approved", type: "Withdraw", details: details, date: new Date().toLocaleString(), amount: `-${reqDoc.amount}`, status: "Success", color: "red" }); } } else if (action === 'Reject' && reqDoc.type === 'Withdraw') { user.balance += reqDoc.amount; user.transactions.unshift({ title: "Withdraw Refund", type: "Refund", details: "Refund", date: new Date().toLocaleString(), amount: `+${reqDoc.amount}`, status: "Refund", color: "green" }); } await user.save(); } res.json({ success: true }); } catch(e) { res.status(500).json({ error: e.message }); } });
app.get('/api/config', async (req, res) => { try { const announcement = await Config.findOne({ key: 'announcement' }); const maxStake = await Config.findOne({ key: 'max_stake' }); const maxWin = await Config.findOne({ key: 'max_win' }); const inviteCode = await Config.findOne({ key: 'invite_code' }); const banner1 = await Config.findOne({ key: 'banner1' }); const banner2 = await Config.findOne({ key: 'banner2' }); const banner3 = await Config.findOne({ key: 'banner3' }); res.json({ announcement: announcement ? announcement.value : "Welcome!", maxStake: maxStake ? parseInt(maxStake.value) : 100000, maxWin: maxWin ? parseInt(maxWin.value) : 5000000, inviteCode: inviteCode ? inviteCode.value : "8888", banner1: banner1 ? banner1.value : "", banner2: banner2 ? banner2.value : "", banner3: banner3 ? banner3.value : "" }); } catch (err) { res.json({}); } });
app.post('/admin/config', async (req, res) => { const { maxStake, maxWin, announcement, banner1, banner2, banner3, inviteCode } = req.body; try { if(announcement) await Config.findOneAndUpdate({ key: 'announcement' }, { value: announcement }, { upsert: true }); if(maxStake) await Config.findOneAndUpdate({ key: 'max_stake' }, { value: maxStake.toString() }, { upsert: true }); if(maxWin) await Config.findOneAndUpdate({ key: 'max_win' }, { value: maxWin.toString() }, { upsert: true }); if(inviteCode) await Config.findOneAndUpdate({ key: 'invite_code' }, { value: inviteCode }, { upsert: true }); if(banner1) await Config.findOneAndUpdate({ key: 'banner1' }, { value: banner1 }, { upsert: true }); if(banner2) await Config.findOneAndUpdate({ key: 'banner2' }, { value: banner2 }, { upsert: true }); if(banner3) await Config.findOneAndUpdate({ key: 'banner3' }, { value: banner3 }, { upsert: true }); res.json({ success: true }); } catch (err) { res.status(500).json({ error: "Update Failed" }); } });
app.get('/admin/report', async (req, res) => { const { date } = req.query; try { const allRequests = await Request.find({ status: { $in: ['Approve', 'Reject'] } }); let dailyData = { deposit: 0, withdraw: 0, net: 0, count: 0, transactions: [] }; allRequests.forEach(r => { const targetDate = date ? new Date(date).toLocaleDateString() : new Date().toLocaleDateString(); if (r.date.includes(targetDate)) { if (r.status === 'Approve') { if (r.type === 'Deposit') dailyData.deposit += r.amount; else if (r.type === 'Withdraw') dailyData.withdraw += r.amount; } dailyData.transactions.push(r); } }); dailyData.net = dailyData.deposit - dailyData.withdraw; res.json(dailyData); } catch (e) { res.status(500).json({ error: "Report Error" }); } });
app.post('/admin/reset-password', async (req, res) => { const { username, newPassword } = req.body; try { const user = await User.findOne({ username }); if (!user) return res.status(404).json({ error: "User not found" }); const hashedPassword = await bcrypt.hash(newPassword, 10); user.password = hashedPassword; await user.save(); res.json({ success: true }); } catch (err) { res.status(500).json({ error: "Failed" }); } });
app.post('/admin/maintenance', async (req, res) => { const { status } = req.body; await Config.findOneAndUpdate({ key: 'maintenance' }, { value: status }, { upsert: true }); await new AdminLog({ action: "Maintenance", admin: "Boss", details: status }).save(); res.json({ success: true }); });
app.post('/admin/notify', async (req, res) => { const { message } = req.body; await Config.findOneAndUpdate({ key: 'global_alert' }, { value: message }, { upsert: true }); res.json({ success: true }); });
app.get('/admin/logs', async (req, res) => { const logs = await AdminLog.find().sort({ _id: -1 }).limit(100); res.json(logs); });
app.get('/api/alert', async (req, res) => { const alert = await Config.findOne({ key: 'global_alert' }); res.json({ message: alert ? alert.value : "" }); });
app.post('/admin/balance', async (req, res) => { const { username, amount, action } = req.body; try { const user = await User.findOne({ username }); const val = parseInt(amount); if (action === 'add') { user.balance += val; user.transactions.unshift({ title: "Deposit (Admin)", date: new Date().toLocaleString(), amount: `+${val}`, status: "Success", color: "green" }); } else { user.balance -= val; user.transactions.unshift({ title: "Withdraw (Admin)", date: new Date().toLocaleString(), amount: `-${val}`, status: "Success", color: "red" }); } await user.save(); res.json({ success: true }); } catch (err) { res.status(500).json({ error: err.message }); } });
app.post('/admin/ban', async (req, res) => { const { username, status } = req.body; try { const user = await User.findOne({ username }); user.isBanned = status; await user.save(); res.json({ success: true }); } catch (err) { res.status(500).json({ error: err.message }); } });
app.post('/admin/settle', async (req, res) => { const { userId, ticketId, outcome } = req.body; try { const user = await User.findOne({ username: userId }); const ticket = user.history.find(t => t.id === ticketId); if(ticket.status !== 'Pending') return; ticket.status = outcome; if (outcome === 'Won') { let winAmountStr = ticket.win.toString().replace(/,/g, '').replace(' MMK', '').trim(); let winAmount = parseInt(winAmountStr); if (isNaN(winAmount) || winAmount <= 0) { let totalOdds = 1; ticket.matches.forEach(m => totalOdds *= parseFloat(m.odds)); winAmount = Math.floor(ticket.stake * totalOdds); ticket.win = winAmount.toLocaleString() + " MMK"; } user.balance += winAmount; user.transactions.unshift({ title: "Win Payout", date: new Date().toLocaleString(), amount: `+${winAmount}`, status: "Success", color: "green" }); } user.markModified('history'); await user.save(); res.json({ success: true }); } catch (err) { res.status(500).json({ error: err.message }); } });

// ✅ 7. REAL API FETCHING (NO MOCK DATA)
let cachedOdds = [];
let lastFetchTime = 0;
const CACHE_DURATION = 30 * 60 * 1000; 
const LEAGUES = [ { key: 'soccer_epl', name: 'Premier League' }, { key: 'soccer_spain_la_liga', name: 'La Liga' }, { key: 'soccer_uefa_champs_league', name: 'Champions League' } ];

app.get('/odds', async (req, res) => {
    // 1. Check Cache
    if (cachedOdds.length > 0 && (Date.now() - lastFetchTime < CACHE_DURATION)) { 
        return res.json(cachedOdds); 
    }

    try {
        console.log("📡 Fetching Real API...");
        const requests = LEAGUES.map(league => 
            axios.get(`https://api.the-odds-api.com/v4/sports/${league.key}/odds`, { 
                params: { apiKey: ODDS_API_KEY, regions: 'eu', markets: 'h2h,totals,spreads', oddsFormat: 'decimal' } 
            }).then(r => r.data.map(g => { 
                const bookie = g.bookmakers.find(b => b.key === 'bet365') || g.bookmakers[0]; 
                let ft = { h: "-", d: "-", a: "-", o: "-", u: "-", line_o: "2.5", hdp_h: "-", hdp_a: "-", line_h: "0" }; 
                if (bookie) { 
                    const h2h = bookie.markets.find(m => m.key === 'h2h'); 
                    if (h2h) { ft.h = h2h.outcomes.find(o => o.name === g.home_team)?.price || "-"; ft.a = h2h.outcomes.find(o => o.name === g.away_team)?.price || "-"; ft.d = h2h.outcomes.find(o => o.name === 'Draw')?.price || "-"; } 
                    const totals = bookie.markets.find(m => m.key === 'totals'); 
                    if (totals) { const over = totals.outcomes.find(o => o.name === 'Over'); const under = totals.outcomes.find(o => o.name === 'Under'); if (over) { ft.o = over.price; ft.line_o = over.point; } if (under) ft.u = under.price; } 
                    const spreads = bookie.markets.find(m => m.key === 'spreads'); 
                    if (spreads) { const home = spreads.outcomes.find(o => o.name === g.home_team); const away = spreads.outcomes.find(o => o.name === g.away_team); if (home) { ft.hdp_h = home.price; ft.line_h = home.point > 0 ? `+${home.point}` : home.point; } if (away) ft.hdp_a = away.price; } 
                } 
                return { id: g.id, home: g.home_team, away: g.away_team, league: { name: league.name }, fixture: { date: g.commence_time }, ft }; 
            })).catch(e => [])
        ); 
        
        const results = await Promise.all(requests); 
        let finalData = results.flat().sort((a, b) => new Date(a.fixture.date) - new Date(b.fixture.date)); 
        
        // NO MOCK FALLBACK - Just return what we found (or empty)
        cachedOdds = finalData; 
        lastFetchTime = Date.now(); 
        res.json(finalData); 

    } catch (e) { 
        console.log("❌ API Error:", e.message);
        res.json([]); // Return empty array on error
    } 
});

// ✅ 8. CORRECT ROUTING (Root -> Login)
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'login.html'))); // Root opens Login
app.get('/home', (req, res) => res.sendFile(path.join(__dirname, 'home.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));
app.get('/:page', (req, res) => {
    const page = req.params.page;
    if (page.endsWith('.html')) res.sendFile(path.join(__dirname, page));
    else res.sendFile(path.join(__dirname, 'login.html')); // Fallback to login
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server Running on Port ${PORT}`));