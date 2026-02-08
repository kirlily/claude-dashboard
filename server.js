const express = require('express');
const path = require('path');
const fs = require('fs');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static('public'));

// 데이터 파일 경로 설정
const STATS_CACHE = path.join(__dirname, 'stats-cache.json');

// 공통 데이터 읽기 함수
function getStats() {
    try {
        if (fs.existsSync(STATS_CACHE)) {
            return JSON.parse(fs.readFileSync(STATS_CACHE, 'utf8'));
        }
    } catch (e) { console.error(e); }
    return { dailyActivity: [], modelUsage: {} };
}

// 1. 통계 데이터
app.get('/api/stats', (req, res) => {
    res.json(getStats());
});

// 2. 계정 정보 (index.html이 요구하는 빈칸 채우기)
app.get('/api/account', (req, res) => {
    res.json({ displayName: "Claude User", subscriptionType: "Pro" });
});

// 3. 세션 정보 (index.html이 요구하는 빈칸 채우기)
app.get('/api/sessions', (req, res) => {
    res.json([]);
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});