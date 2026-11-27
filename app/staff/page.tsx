"use client";

import Link from "next/link";

import { FormEvent, useEffect, useState } from "react";

type PermissionKey = "VIEW_REPORTS" | "VIEW_ALL_ORDERS" | "MANAGE_INVENTORY" | "MANAGE_PURCHASING" | "PROCESS_REFUNDS" | "MANAGE_TABLES";
type Branch = { id: string; name: string; code: string; timezone: string; currency: string };
type Staff = { id: string; name: string; email: string; role: "OWNER" | "MANAGER" | "CASHIER" | "KITCHEN" | "DRIVER"; active: boolean; approvalStatus?: "PENDING" | "APPROVED" | "REJECTED"; phone?: string | null; photoUrl?: string | null; employeeCode?: string | null; branch?: { id: string; name: string; code: string }; createdAt?: string; permissions?: Record<PermissionKey, boolean> };
const permissionLabels: Record<PermissionKey, string> = { VIEW_REPORTS: "Reports", VIEW_ALL_ORDERS: "All orders", MANAGE_INVENTORY: "Inventory", MANAGE_PURCHASING: "Purchasing", PROCESS_REFUNDS: "Refunds", MANAGE_TABLES: "Tables" };
export default function StaffPage() {
  const [users, setUsers] = useState<Staff[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState("");
  const [phone, setPhone] = useState("");
  const [employeeCode, setEmployeeCode] = useState("");
  const [photoUrl, setPhotoUrl] = useState("");
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [branchName, setBranchName] = useState("");
  const [branchCode, setBranchCode] = useState("");
  const [branchTimezone, setBranchTimezone] = useState("Asia/Kabul");
  const [branchCurrency, setBranchCurrency] = useState("AFN");
  const [currentRole, setCurrentRole] = useState("CASHIER");
  const [currentUserId, setCurrentUserId] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("CASHIER");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  async function load() {
    const response = await fetch("/api/admin/staff", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not load staff.");
    setUsers(data.users);
    setCurrentRole(data.currentRole);
    setCurrentUserId(data.currentUserId);
    const branchResponse = await fetch("/api/admin/branches", { cache: "no-store" });
    const branchData = await branchResponse.json();
    if (!branchResponse.ok) throw new Error(branchData.error || "Could not load branches.");
    setBranches(branchData.branches);
    setBranchId((current) => current || branchData.branches[0]?.id || "");
  }
  useEffect(() => { void load().catch((error) => setNotice(error.message)); }, []);
  async function createBranch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setNotice("");
    try {
      const response = await fetch("/api/admin/branches", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: branchName, code: branchCode, timezone: branchTimezone, currency: branchCurrency }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not create branch.");
      setBranchName(""); setBranchCode(""); setBranchId(data.branch.id); setNotice(`Branch ${data.branch.name} created.`); await load();
      setBranchId(data.branch.id);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not create branch."); }
    finally { setBusy(false); }
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setNotice("");
    try {
      let uploadedPhotoUrl = photoUrl;
      if (photoFile) {
        const uploadBody = new FormData();
        uploadBody.append("photo", photoFile);
        const uploadResponse = await fetch("/api/admin/staff/photo", { method: "POST", body: uploadBody });
        const uploadData = await uploadResponse.json();
        if (!uploadResponse.ok) throw new Error(uploadData.error || "Could not upload staff photo.");
        uploadedPhotoUrl = uploadData.photoUrl;
      }
      const response = await fetch("/api/admin/staff", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, email, password, role, branchId, phone, employeeCode, photoUrl: uploadedPhotoUrl }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not create staff account.");
      setName(""); setEmail(""); setPassword(""); setPhone(""); setEmployeeCode(""); setPhotoUrl(""); setPhotoFile(null); setRole("CASHIER"); setNotice(data.message || "Staff account created."); await load();
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not create staff account."); }
    finally { setBusy(false); }
  }
  async function update(user: Staff, patch: { active?: boolean; role?: string; approvalStatus?: "APPROVED" | "REJECTED" }) {
    const response = await fetch(`/api/admin/staff/${user.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
    const data = await response.json();
    if (!response.ok) setNotice(data.error || "Could not update staff.");
    else { setNotice("Staff account updated."); await load(); }
  }

  async function updatePermission(user: Staff, permission: PermissionKey, enabled: boolean) {
    const overrides = Object.fromEntries((Object.keys(permissionLabels) as PermissionKey[]).map((key) => [key, key === permission ? enabled : user.permissions?.[key]]).filter((entry) => typeof entry[1] === "boolean"));
    const response = await fetch(`/api/admin/staff/${user.id}/permissions`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ overrides }) });
    const data = await response.json();
    if (!response.ok) { setNotice(data.error || "Could not update permissions."); return; }
    setNotice("Staff permissions updated."); await load();
  }

  async function resetPassword(user: Staff) {
    const nextPassword = window.prompt(`Set a new temporary password for ${user.name} (minimum 12 characters)`);
    if (nextPassword === null) return;
    const confirmPassword = window.prompt("Enter the new temporary password again");
    if (confirmPassword === null) return;
    if (nextPassword !== confirmPassword) { setNotice("The passwords do not match."); return; }
    try {
      const response = await fetch(`/api/admin/staff/${user.id}/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newPassword: nextPassword }),
      });
      const data = await response.json();
      setNotice(response.ok ? "Password reset. The employee must sign in again." : data.error || "Could not reset password.");
    } catch {
      setNotice("Password reset request failed. Check the connection and try again.");
    }
  }
  return (
    <main className="catalog-admin">
      <header className="catalog-admin-header"><Link href="/" className="catalog-back">← Back to POS</Link><div><span>JUICE SHOP · MANAGEMENT</span><h1>Staff & permissions</h1><p>Create staff logins and control account access.</p></div></header>
      {notice && <p className="catalog-notice" role="status">{notice}</p>}
      <section className="staff-grid">
        <form className="catalog-editor" onSubmit={create}>
          <div className="catalog-section-head"><div><span>NEW ACCOUNT</span><h2>Add staff member</h2></div></div>
          <label>Full name<input required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} /></label>
          <label>Email address<input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
          <label>Temporary password<input required type="password" minLength={12} maxLength={200} value={password} onChange={(e) => setPassword(e.target.value)} /><small>At least 12 characters. Share it securely and ask the employee to change it after first sign-in.</small></label>
          <label>Phone number<input type="tel" maxLength={30} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Optional"/></label>
          <label>Employee ID<input maxLength={24} value={employeeCode} onChange={(e) => setEmployeeCode(e.target.value)} placeholder="Optional unique staff code"/></label>
          <label>Employee photo<input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setPhotoFile(e.target.files?.[0] ?? null)}/><small>JPG, PNG or WebP · maximum 3 MB. Optional.</small></label>
          <label>Assigned branch<select required value={branchId} onChange={(e) => setBranchId(e.target.value)}>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name} · {branch.code}</option>)}</select></label>
          <label>Role<select value={role} onChange={(e) => setRole(e.target.value)}><option value="CASHIER">Cashier</option><option value="KITCHEN">Kitchen staff</option><option value="DRIVER">Delivery driver</option>{currentRole === "OWNER" && <option value="MANAGER">Manager</option>}</select></label>
          <button className="catalog-primary" disabled={busy || !branchId}>{busy ? "Creating…" : "Create staff account"}</button>
        </form>
        {currentRole === "OWNER" && <form className="catalog-editor" onSubmit={createBranch}><div className="catalog-section-head"><div><span>BRANCH DIRECTORY</span><h2>Add a branch</h2></div></div><label>Branch name<input required minLength={2} maxLength={80} value={branchName} onChange={(e) => setBranchName(e.target.value)} placeholder="e.g. Kabul City Centre"/></label><label>Branch code<input required minLength={2} maxLength={12} value={branchCode} onChange={(e) => setBranchCode(e.target.value.toUpperCase())} placeholder="e.g. KBL01"/></label><label>Timezone<input required value={branchTimezone} onChange={(e) => setBranchTimezone(e.target.value)} placeholder="Asia/Kabul"/></label><label>Currency<input required minLength={3} maxLength={3} value={branchCurrency} onChange={(e) => setBranchCurrency(e.target.value.toUpperCase())}/></label><button className="catalog-primary" disabled={busy}>{busy ? "Saving…" : "Create branch"}</button><small>New employees can be assigned to this branch.</small></form>}
        <section className="catalog-list"><div className="catalog-section-head"><div><span>ACCESS DIRECTORY</span><h2>Team members <small>{users.length}</small></h2></div></div>
          {users.map((user) => <article className="catalog-product" key={user.id}>{user.photoUrl ? <img className="catalog-placeholder" src={user.photoUrl} alt={user.name}/> : <div className="catalog-placeholder">{user.name.slice(0,1).toUpperCase()}</div>}<div className="catalog-product-info"><b>{user.name}</b><span>{user.email}</span><small>{user.role} · {user.approvalStatus === "PENDING" ? "Awaiting platform owner approval" : user.approvalStatus === "REJECTED" ? "Approval rejected" : user.active ? "Active" : "Disabled"}</small><small>Branch: {user.branch?.name ?? "Not assigned"}{user.employeeCode ? ` · ID ${user.employeeCode}` : ""}</small>{user.phone && <small>Phone: {user.phone}</small>}{currentRole === "OWNER" && user.role !== "OWNER" && <details className="staff-permissions"><summary>Configure permissions</summary><div className="staff-permission-grid">{(Object.keys(permissionLabels) as PermissionKey[]).map((permission) => <label key={permission}><input type="checkbox" checked={Boolean(user.permissions?.[permission])} onChange={(event) => void updatePermission(user, permission, event.target.checked)} />{permissionLabels[permission]}</label>)}</div><small>Changes take effect on the next API request.</small></details>}</div><div className="catalog-product-actions">{user.id !== currentUserId && <>{currentRole === "OWNER" && user.approvalStatus === "PENDING" && <><button type="button" onClick={() => void update(user, { approvalStatus: "APPROVED" })}>Approve staff</button><button type="button" onClick={() => void update(user, { approvalStatus: "REJECTED" })}>Reject request</button></>}{(currentRole === "OWNER" || user.role === "CASHIER" || user.role === "KITCHEN" || user.role === "DRIVER") && <button type="button" onClick={() => void resetPassword(user)}>Reset password</button>}{user.role !== "OWNER" && user.approvalStatus === "APPROVED" && (currentRole === "OWNER" || user.role === "CASHIER" || user.role === "KITCHEN") && <button type="button" onClick={() => void update(user, { active: !user.active })}>{user.active ? "Disable" : "Enable"}</button>}</>}</div></article>)}
          {!users.length && <p>No staff accounts found.</p>}
        </section>
      </section>
    </main>
  );
}
