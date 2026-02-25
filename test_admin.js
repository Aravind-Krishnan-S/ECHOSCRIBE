async function testAdmin() {
    const logs = await fetch("http://localhost:3000/api/auth/login", {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: "admin@gmail.com", password: "admin" })
    });
    const loginData = await logs.json();
    console.log("Login res:", loginData);
    if (!loginData.session) return;

    const token = loginData.session.access_token;

    const postRes = await fetch("http://localhost:3000/api/patients", {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
            name: "Test Mentee",
            mode: "Mentoring"
        })
    });

    console.log("Create patient status:", postRes.status);
    console.log("Response JSON:", await postRes.text());
}
testAdmin();
