import { redirect } from "next/navigation";

// The department login is now merged into the single sign-in at /login, which
// resolves the role (PA staff vs department) from the credentials and routes
// accordingly. Any hit here — bookmarks, sign-out, deep links — funnels there.
export default function DepartmentLoginPage() {
  redirect("/login");
}
