import { z } from "zod"

export const loginSchema = z.object({
  email: z.string().min(1, "Email is required").email("Enter a valid email"),
  password: z.string().min(1, "Password is required"),
  captcha: z.string().min(1, "Security code is required"),
})

export type LoginFormValues = z.infer<typeof loginSchema>
