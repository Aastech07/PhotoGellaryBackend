# 📸 Gallery Node.js Express MongoDB Server

Ek high-speed Node.js + Express backend server jo Android app ke local gallery photos ko direct MongoDB aur disk storage pe upload karta hai.

## 🚀 Features
- **Node.js + Express** fast REST API
- **MongoDB + Mongoose** photo metadata storage
- **Multer** high-speed image streaming storage
- **Built-in Web Dashboard** (`http://localhost:5000`) real-time live preview ke saath
- **Fallback Resilience**: Agar MongoDB kisi waqt band ho, tab bhi upload fail nahi hoga (photos disk par safe save hongi aur MongoDB connect hote hi sync hongi).

---

## 🛠️ Setup & Run

### 1. Dependencies Install karein:
```bash
cd server
npm install
```

### 2. Server Start karein:
```bash
npm start
```
Server start hone par console me aayega:
```text
============================================================
🚀 GALLERY SERVER RUNNING (Node.js + Express + MongoDB)
============================================================
💻 Local Web Dashboard:   http://localhost:5000
📱 Wi-Fi (Android Phone):  http://<AAPKA_IP>:5000
🤖 Android Emulator:       http://10.0.2.2:5000
============================================================
```

---

## 📱 Android App Connection:
1. Agar aap **Android Emulator** use kar rahe hain:
   - Server URL: `http://10.0.2.2:5000`
2. Agar aap **Real Android Phone** use kar rahe hain (same Wi-Fi pe):
   - Server URL: `http://10.171.94.177:5000` (ya jo bhi aapka Wi-Fi IP ho)

---

## 🍃 MongoDB Configuration:
- By default `mongodb://127.0.0.1:27017/gallery_db` par connect karta hai.
- Agar aap MongoDB Atlas (Cloud) use karna chahte hain, to `.env` file me `MONGODB_URI` update kar dein:
```env
MONGODB_URI=mongodb+srv://user:pass@cluster.mongodb.net/gallery_db?retryWrites=true&w=majority
```
