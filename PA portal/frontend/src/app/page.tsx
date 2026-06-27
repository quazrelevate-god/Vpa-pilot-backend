import { redirect } from "next/navigation";

// Root always goes to appointments — middleware handles auth guard.
// Logged-out users are intercepted by middleware and sent to /login.
export default function Home() {
  redirect("/appointments");
}
