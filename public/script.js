async function loadStats() {
    try {
        const response = await fetch('/api/stats');
        const data = await response.json();

        // 총 메시지 수 업데이트
        document.querySelector('.total-messages').textContent = data.totalMessages.toLocaleString();
        
        // 총 세션 수 업데이트
        document.querySelector('.total-sessions').textContent = data.totalSessions.toLocaleString();

        // 더 많은 데이터를 화면에 뿌려주는 코드가 여기에 들어갑니다.
        console.log("데이터 로드 성공:", data);
    } catch (error) {
        console.error("데이터 로딩 실패:", error);
    }
}

loadStats();