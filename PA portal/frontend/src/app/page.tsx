import { redirect } from "next/navigation";

// The middleware decides whether the user lands on /login or /overview based
// on the dash_session cookie. This route just hands off.
export default function Home() {
  redirect("/overview");
}
