import { db } from "./client"
import { users } from "@/db/tables"
import { eq } from "drizzle-orm"
import { hashPassword } from "@/Framework/Auth/password"

async function seed() {
  const email = process.env.OWNER_EMAIL
  const password = process.env.OWNER_PASSWORD

  if (!email || !password) {
    throw new Error(
      "Set OWNER_EMAIL and OWNER_PASSWORD env vars before running the seed script."
    )
  }

  const existing = await db.query.users.findFirst({
    where: eq(users.email, email),
  })

  if (existing) {
    console.log(`Owner account already exists for ${email}, skipping.`)
    return
  }

  const passwordHash = await hashPassword(password)

  await db.insert(users).values({
    email,
    passwordHash,
    name: "Owner",
    // The one account that is explicitly "owner" rather than the column's
    // "admin" default. Every other role is granted from this one, and an owner
    // can only be demoted by itself — so seeding it is what makes the whole
    // role system reachable on a fresh database.
    role: "owner",
  })

  console.log(`Owner account created for ${email}.`)
}

seed()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
