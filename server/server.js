const express = require("express");
const cors = require("cors");
const bcrypt = require("bcrypt");
const db = require("./db");

const app = express();

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

// -------------------- ROOT --------------------

app.get("/", (req, res) => {
  res.send("Archery Club API работает");
});

// -------------------- AUTH --------------------

app.post("/api/login", async (req, res) => {
  try {
    const { login, password } = req.body;

    const [users] = await db.query(
      "SELECT * FROM users WHERE login = ?",
      [login]
    );

    if (users.length === 0) {
      return res.status(401).json({
        message: "Неверный логин или пароль",
      });
    }

    const user = users[0];

    let validPassword = false;

    if (user.password_hash.startsWith("$2")) {
      validPassword = await bcrypt.compare(
        password,
        user.password_hash
      );
    } else {
      validPassword = user.password_hash === password;
    }

    if (!validPassword) {
      return res.status(401).json({
        message: "Неверный логин или пароль",
      });
    }

    res.json({
      id: user.id,
      login: user.login,
      role: user.role,
      name: user.name,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      message: "Ошибка сервера",
    });
  }
});

// -------------------- REGISTER --------------------

app.post("/api/register", async (req, res) => {
  try {
    const { name, age, login, password } = req.body;

    const [existing] = await db.query(
      "SELECT id FROM users WHERE login = ?",
      [login]
    );

    if (existing.length > 0) {
      return res.status(400).json({
        message: "Такой логин уже существует",
      });
    }

    const hash = await bcrypt.hash(password, 10);

    const [userResult] = await db.query(
      `INSERT INTO users 
      (login, password_hash, role, name)
      VALUES (?, ?, 'participant', ?)`,
      [login, hash, name]
    );

    await db.query(
      `INSERT INTO participants
      (user_id, name, age, subscription_id, remaining, status, blocked)
      VALUES (?, ?, ?, 1, 4, 'active', false)`,
      [userResult.insertId, name, age]
    );

    res.json({
      message: "Пользователь зарегистрирован",
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      message: "Ошибка сервера",
    });
  }
});

// -------------------- PARTICIPANTS --------------------

app.get("/api/participants", async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT
        p.id,
        p.user_id,
        p.name,
        p.age,
        p.phone,
        p.email,
        p.notes,
        p.subscription_id,
        s.name AS subscription,
        p.remaining,
        p.status,
        p.blocked
      FROM participants p
      LEFT JOIN subscriptions s
      ON p.subscription_id = s.id
      ORDER BY p.id
    `);

    res.json(rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({
      message: "Ошибка сервера",
    });
  }
});

app.post("/api/participants", async (req, res) => {
  try {
    const {
      name,
      age,
      phone,
      email,
      login,
      password,
      role,
      subscription_id,
    } = req.body;

    const [exists] = await db.query(
      "SELECT id FROM users WHERE login = ?",
      [login]
    );

    if (exists.length > 0) {
      return res.status(400).json({
        message: "Такой логин уже существует",
      });
    }

    const hash = await bcrypt.hash(password, 10);

    const [userResult] = await db.query(
      `INSERT INTO users
      (login, password_hash, role, name)
      VALUES (?, ?, ?, ?)`,
      [login, hash, role, name]
    );

    await db.query(
      `INSERT INTO participants
      (user_id, name, age, phone, email, subscription_id, remaining, status, blocked)
      VALUES (?, ?, ?, ?, ?, ?, 4, 'active', false)`,
      [
        userResult.insertId,
        name,
        age,
        phone,
        email,
        subscription_id,
      ]
    );

    res.json({
      message: "Пользователь добавлен",
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      message: "Ошибка сервера",
    });
  }
});

app.put("/api/participants/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const {
      name,
      age,
      phone,
      email,
      subscription_id,
      status,
      blocked,
      remaining,
    } = req.body;

    await db.query(
      `UPDATE participants
      SET
        name = ?,
        age = ?,
        phone = ?,
        email = ?,
        subscription_id = ?,
        status = ?,
        blocked = ?,
        remaining = ?
      WHERE id = ?`,
      [
        name,
        age,
        phone,
        email,
        subscription_id,
        status,
        blocked,
        remaining,
        id,
      ]
    );

    res.json({
      message: "Участник обновлён",
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      message: "Ошибка обновления",
    });
  }
});

// -------------------- SUBSCRIPTIONS --------------------

app.get("/api/subscriptions", async (req, res) => {
  try {
    const [rows] = await db.query(
      "SELECT * FROM subscriptions ORDER BY id"
    );

    res.json(rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({
      message: "Ошибка сервера",
    });
  }
});

app.post("/api/subscriptions", async (req, res) => {
  try {
    const {
      name,
      price,
      description,
      visits,
      accessLevel,
    } = req.body;

    await db.query(
      `INSERT INTO subscriptions
      (name, price, description, visits, accessLevel)
      VALUES (?, ?, ?, ?, ?)`,
      [
        name,
        price,
        description,
        visits || 0,
        accessLevel || "full",
      ]
    );

    res.json({
      message: "Абонемент добавлен",
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      message: "Ошибка добавления",
    });
  }
});

app.put("/api/subscriptions/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const {
      name,
      price,
      description,
      visits,
      accessLevel,
    } = req.body;

    await db.query(
      `UPDATE subscriptions
      SET
        name = ?,
        price = ?,
        description = ?,
        visits = ?,
        accessLevel = ?
      WHERE id = ?`,
      [
        name,
        price,
        description,
        visits,
        accessLevel,
        id,
      ]
    );

    res.json({
      message: "Абонемент обновлён",
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      message: "Ошибка обновления",
    });
  }
});

app.delete("/api/subscriptions/:id", async (req, res) => {
  try {
    const { id } = req.params;

    await db.query(
      "DELETE FROM subscriptions WHERE id = ?",
      [id]
    );

    res.json({
      message: "Абонемент удалён",
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      message: "Ошибка удаления",
    });
  }
});

// -------------------- TRAINERS --------------------

app.get("/api/trainers", async (req, res) => {
  try {
    const [rows] = await db.query(
      "SELECT * FROM trainers ORDER BY id"
    );

    res.json(rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({
      message: "Ошибка сервера",
    });
  }
});

// -------------------- INVENTORY --------------------

app.get("/api/inventory", async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT
        i.id,
        i.item,
        i.status,
        p.name AS issuedTo
      FROM inventory i
      LEFT JOIN participants p
      ON i.issued_to_participant_id = p.id
      ORDER BY i.id
    `);

    res.json(rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({
      message: "Ошибка сервера",
    });
  }
});

// -------------------- TRAININGS --------------------

app.get("/api/trainings", async (req, res) => {
  try {
    const [trainings] = await db.query(`
      SELECT
        t.id,
        t.title,
        DATE_FORMAT(t.training_date, '%Y-%m-%d') AS date,
        TIME_FORMAT(t.start_time, '%H:%i') AS time,
        TIME_FORMAT(t.end_time, '%H:%i') AS endTime,
        tr.name AS trainer,
        t.trainer_id,
        t.slots,
        t.comment
      FROM trainings t
      JOIN trainers tr
      ON t.trainer_id = tr.id
      ORDER BY t.training_date, t.start_time
    `);

    for (const training of trainings) {
      const [bookings] = await db.query(
        `SELECT participant_id, confirmed, attended
        FROM training_bookings
        WHERE training_id = ?`,
        [training.id]
      );

      training.participants = bookings.map(
        (b) => b.participant_id
      );

      training.confirmed = bookings
        .filter((b) => b.confirmed)
        .map((b) => b.participant_id);

      training.attended = bookings
        .filter((b) => b.attended)
        .map((b) => b.participant_id);
    }

    res.json(trainings);
  } catch (error) {
    console.error(error);
    res.status(500).json({
      message: "Ошибка сервера",
    });
  }
});

app.post("/api/trainings", async (req, res) => {
  try {
    const {
      title,
      training_date,
      start_time,
      end_time,
      trainer_id,
      slots,
      comment,
    } = req.body;

    await db.query(
      `INSERT INTO trainings
      (
        title,
        training_date,
        start_time,
        end_time,
        trainer_id,
        slots,
        comment
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        title,
        training_date,
        start_time,
        end_time,
        trainer_id,
        slots,
        comment,
      ]
    );

    res.json({
      message: "Тренировка добавлена",
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      message: "Ошибка добавления",
    });
  }
});

app.put("/api/trainings/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const {
      title,
      training_date,
      start_time,
      end_time,
      trainer_id,
      slots,
      comment,
    } = req.body;

    await db.query(
      `UPDATE trainings
      SET
        title = ?,
        training_date = ?,
        start_time = ?,
        end_time = ?,
        trainer_id = ?,
        slots = ?,
        comment = ?
      WHERE id = ?`,
      [
        title,
        training_date,
        start_time,
        end_time,
        trainer_id,
        slots,
        comment,
        id,
      ]
    );

    res.json({
      message: "Тренировка обновлена",
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      message: "Ошибка обновления",
    });
  }
});

app.delete("/api/trainings/:id", async (req, res) => {
  try {
    const { id } = req.params;

    await db.query(
      "DELETE FROM training_bookings WHERE training_id = ?",
      [id]
    );

    await db.query(
      "DELETE FROM results WHERE training_id = ?",
      [id]
    );

    await db.query(
      "DELETE FROM trainings WHERE id = ?",
      [id]
    );

    res.json({
      message: "Тренировка удалена",
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      message: "Ошибка удаления",
    });
  }
});

// -------------------- BOOKINGS --------------------

app.post("/api/trainings/:id/book", async (req, res) => {
  try {
    const { id } = req.params;
    const { participant_id } = req.body;

    const [trainingRows] = await db.query(
      "SELECT slots FROM trainings WHERE id = ?",
      [id]
    );

    if (trainingRows.length === 0) {
      return res.status(404).json({
        message: "Тренировка не найдена",
      });
    }

    const [countRows] = await db.query(
      `SELECT COUNT(*) AS count
      FROM training_bookings
      WHERE training_id = ?`,
      [id]
    );

    if (
      countRows[0].count >= trainingRows[0].slots
    ) {
      return res.status(400).json({
        message: "Свободных мест нет",
      });
    }

    await db.query(
      `INSERT INTO training_bookings
      (training_id, participant_id, confirmed, attended)
      VALUES (?, ?, false, false)`,
      [id, participant_id]
    );

    res.json({
      message: "Запись успешна",
    });
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") {
      return res.status(400).json({
        message: "Участник уже записан",
      });
    }

    console.error(error);

    res.status(500).json({
      message: "Ошибка сервера",
    });
  }
});

app.put(
  "/api/trainings/:trainingId/confirm/:participantId",
  async (req, res) => {
    try {
      const { trainingId, participantId } =
        req.params;

      await db.query(
        `UPDATE training_bookings
        SET confirmed = true
        WHERE training_id = ?
        AND participant_id = ?`,
        [trainingId, participantId]
      );

      res.json({
        message: "Запись подтверждена",
      });
    } catch (error) {
      console.error(error);

      res.status(500).json({
        message: "Ошибка сервера",
      });
    }
  }
);

app.put(
  "/api/trainings/:trainingId/attendance/:participantId",
  async (req, res) => {
    try {
      const { trainingId, participantId } =
        req.params;

      await db.query(
        `UPDATE training_bookings
        SET confirmed = true,
            attended = true
        WHERE training_id = ?
        AND participant_id = ?`,
        [trainingId, participantId]
      );

      await db.query(
        `UPDATE participants
        SET remaining =
        CASE
          WHEN remaining = 999 THEN 999
          WHEN remaining > 0 THEN remaining - 1
          ELSE 0
        END
        WHERE id = ?`,
        [participantId]
      );

      res.json({
        message: "Посещение отмечено",
      });
    } catch (error) {
      console.error(error);

      res.status(500).json({
        message: "Ошибка сервера",
      });
    }
  }
);

// -------------------- RESULTS --------------------

app.get("/api/results", async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT
        id,
        participant_id AS participantId,
        training_id AS trainingId,
        score,
        comment
      FROM results
      ORDER BY id
    `);

    res.json(rows);
  } catch (error) {
    console.error(error);

    res.status(500).json({
      message: "Ошибка сервера",
    });
  }
});

app.post("/api/results", async (req, res) => {
  try {
    const {
      participant_id,
      training_id,
      score,
      comment,
    } = req.body;

    const [existing] = await db.query(
      `SELECT id FROM results
      WHERE participant_id = ?
      AND training_id = ?`,
      [participant_id, training_id]
    );

    if (existing.length > 0) {
      await db.query(
        `UPDATE results
        SET score = ?,
            comment = ?
        WHERE participant_id = ?
        AND training_id = ?`,
        [
          score,
          comment,
          participant_id,
          training_id,
        ]
      );
    } else {
      await db.query(
        `INSERT INTO results
        (participant_id, training_id, score, comment)
        VALUES (?, ?, ?, ?)`,
        [
          participant_id,
          training_id,
          score,
          comment,
        ]
      );
    }

    res.json({
      message: "Результат сохранён",
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      message: "Ошибка сохранения",
    });
  }
});

// -------------------- START --------------------

app.listen(PORT, () => {
  console.log(
    `Сервер запущен: http://localhost:${PORT}`
  );
});