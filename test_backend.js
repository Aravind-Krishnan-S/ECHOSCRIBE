async function testBackend() {
    // Signup
    const res = await fetch("http://localhost:3000/api/auth/signup", {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: "testdev123@gmail.com", password: "Password123!" })
    });

    // Login
    const logs = await fetch("http://localhost:3000/api/auth/login", {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: "testdev123@gmail.com", password: "Password123!" })
    });
    const loginData = await logs.json();
    const token = loginData.session.access_token;

    const postRes = await fetch("http://localhost:3000/api/patients", {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
            name: "Test Mentee",
            mode: "Mentoring",
            age: 20,
            gender: "Male",
            notes: "Optional context",
            email: "sas@gmail.com",
            phone: "+123456789"
        })
    });

    console.log("Status:", postRes.status);
    console.log("Response:", await postRes.text());
}
testBackend();
