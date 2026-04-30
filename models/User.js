
import db from '../config/db.js';

// Create a new user
export async function createUser({ firstName, lastName, email, password }) {
	const result = await db.query(
		`INSERT INTO users (first_name, last_name, email, password) VALUES ($1, $2, $3, $4) RETURNING id, first_name, last_name, email`,
		[firstName, lastName, email, password]
	);
	return result.rows[0];
}

// Find user by email
export async function findUserByEmail(email) {
	const result = await db.query(
		`SELECT id, first_name, last_name, email, password FROM users WHERE email = $1`,
		[email]
	);
	return result.rows[0];
}

// Find user by id
export async function findUserById(id) {
	const result = await db.query(
		`SELECT id, first_name, last_name, email FROM users WHERE id = $1`,
		[id]
	);
	return result.rows[0];
}

