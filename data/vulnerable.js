app.get("/user", async (req, res) => {
    const query = `SELECT * FROM users WHERE id = '${req.query.id}'`;
    const user = await db.execute(query);
    res.json(user);
});