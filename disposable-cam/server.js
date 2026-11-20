const express = require('express'), multer = require('multer'), QR = require('qrcode');
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const app = express(); app.set('trust proxy', true); app.use(express.json());
const DB = path.join(__dirname, 'data.json'), UP = path.join(__dirname, 'uploads');
fs.mkdirSync(UP, { recursive: true });
let db = fs.existsSync(DB) ? JSON.parse(fs.readFileSync(DB)) : { events: {} };
const save = () => fs.writeFileSync(DB, JSON.stringify(db));
const rid = n => crypto.randomBytes(n).toString('hex');
const revealed = e => Date.now() >= new Date(e.revealAt).getTime();
const ev = (req, res) => { const e = db.events[req.params.id]; if (!e) res.status(404).json({ error: 'Acara tidak ditemukan' }); return e; };

app.post('/api/events', (req, res) => {
  const { name, quota = 36, revealAt } = req.body;
  if (!name || !revealAt) return res.status(400).json({ error: 'Nama acara dan waktu reveal wajib diisi' });
  const e = { id: rid(4), key: rid(8), name: String(name).slice(0, 80), quota: Math.min(Math.max(+quota || 36, 1), 200),
    revealAt: new Date(revealAt).toISOString(), photos: [] };
  db.events[e.id] = e; save(); res.json({ id: e.id, key: e.key });
});

app.get('/api/events/:id', (req, res) => {
  const e = ev(req, res); if (!e) return;
  res.json({ name: e.name, quota: e.quota, revealAt: e.revealAt, revealed: revealed(e),
    used: e.photos.filter(p => p.gid === req.query.gid).length,
    ...(req.query.key === e.key && { total: e.photos.length }) });
});

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, f, cb) => { const d = path.join(UP, req.params.id); fs.mkdirSync(d, { recursive: true }); cb(null, d); },
    filename: (req, f, cb) => cb(null, rid(8) + '.jpg') }),
  limits: { fileSize: 40e6 } });

app.post('/api/events/:id/photos',
  (req, res, next) => db.events[req.params.id] ? next() : res.status(404).json({ error: 'Acara tidak ditemukan' }),
  upload.single('photo'), (req, res) => {
    const e = db.events[req.params.id], gid = req.body.gid;
    const used = e.photos.filter(p => p.gid === gid).length;
    if (!req.file || !gid || used >= e.quota) { if (req.file) fs.unlinkSync(req.file.path); return res.status(403).json({ error: 'Jatah foto habis' }); }
    e.photos.push({ file: req.file.filename, gid, guest: String(req.body.guest || 'Tamu').slice(0, 40), at: Date.now() });
    save(); res.json({ used: used + 1 });
  });

app.get('/api/events/:id/photos', (req, res) => {
  const e = ev(req, res); if (!e) return;
  if (!revealed(e)) return res.status(403).json({ error: 'Belum waktunya reveal' });
  res.json(e.photos.map(p => ({ url: `/files/${e.id}/${p.file}`, guest: p.guest })));
});

app.get('/files/:id/:f', (req, res) => {
  const e = ev(req, res); if (!e) return;
  if (!revealed(e)) return res.status(403).end();
  res.sendFile(path.join(UP, e.id, path.basename(req.params.f)));
});

app.get('/api/events/:id/qr', async (req, res) => {
  const e = ev(req, res); if (!e) return;
  res.type('png').send(await QR.toBuffer(`${req.protocol}://${req.get('host')}/e/${e.id}`, { width: 800, margin: 2 }));
});

app.get('/e/:id', (q, r) => r.sendFile(path.join(__dirname, 'public/guest.html')));
app.use(express.static(path.join(__dirname, 'public')));
app.listen(process.env.PORT || 3000, () => console.log('Jalan di http://localhost:' + (process.env.PORT || 3000)));
