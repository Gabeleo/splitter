import { useState, useEffect, FormEvent } from "react";
import "./App.css";

const API_URL = "/api";

interface Split {
  person: string;
  share_amount: number;
}

interface Purchase {
  id: number;
  description: string;
  amount: number;
  paid_by: string;
  created_at: string;
  splits: Split[];
}

interface Member {
  id: number;
  name: string;
}

type Screen = "group" | "member" | "main";

function App() {
  const [screen, setScreen] = useState<Screen>("group");

  // Group state
  const [groupCode, setGroupCode] = useState("");
  const [groupId, setGroupId] = useState<number | null>(null);
  const [groupError, setGroupError] = useState("");

  // Member state
  const [members, setMembers] = useState<Member[]>([]);
  const [currentUser, setCurrentUser] = useState("");
  const [newMemberName, setNewMemberName] = useState("");
  const [memberError, setMemberError] = useState("");
  const [showNewMember, setShowNewMember] = useState(false);

  // Purchase state
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [splitWith, setSplitWith] = useState<string[]>([]);
  const [error, setError] = useState("");

  const fetchMembers = async (gId: number) => {
    const res = await fetch(`${API_URL}/groups/${gId}/members`);
    const data = await res.json();
    setMembers(data);
  };

  const fetchPurchases = async () => {
    if (!groupId) return;
    try {
      const res = await fetch(`${API_URL}/groups/${groupId}/purchases`);
      const data = await res.json();
      setPurchases(data);
    } catch {
      console.error("Failed to fetch purchases");
    }
  };

  useEffect(() => {
    if (screen === "main" && groupId) fetchPurchases();
  }, [screen, groupId]);

  // --- Screen 1: Group Code ---
  const handleJoinGroup = async (e: FormEvent) => {
    e.preventDefault();
    setGroupError("");
    if (!groupCode.trim()) {
      setGroupError("Enter a group code");
      return;
    }
    try {
      const res = await fetch(`${API_URL}/groups/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: groupCode }),
      });
      if (!res.ok) {
        setGroupError("Failed to join group");
        return;
      }
      const group = await res.json();
      setGroupId(group.id);
      await fetchMembers(group.id);
      setScreen("member");
    } catch {
      setGroupError("Failed to connect to server");
    }
  };

  // --- Screen 2: Member Selection ---
  const handleSelectMember = (name: string) => {
    setCurrentUser(name);
    setScreen("main");
  };

  const handleCreateMember = async (e: FormEvent) => {
    e.preventDefault();
    setMemberError("");
    if (!newMemberName.trim()) {
      setMemberError("Enter a name");
      return;
    }
    try {
      const res = await fetch(`${API_URL}/groups/${groupId}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newMemberName.trim() }),
      });
      if (!res.ok) {
        const data = await res.json();
        setMemberError(data.error || "Failed to create member");
        return;
      }
      const member = await res.json();
      setNewMemberName("");
      setShowNewMember(false);
      await fetchMembers(groupId!);
      handleSelectMember(member.name);
    } catch {
      setMemberError("Failed to connect to server");
    }
  };

  // --- Screen 3: Purchases ---
  const toggleSplitWith = (name: string) => {
    setSplitWith((prev) =>
      prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]
    );
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    if (!description || !amount || splitWith.length === 0) {
      setError("Fill in all fields and select who to split with");
      return;
    }
    try {
      const res = await fetch(`${API_URL}/groups/${groupId}/purchases`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description,
          amount: parseFloat(amount),
          paidBy: currentUser,
          splitWith,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to create purchase");
        return;
      }
      setDescription("");
      setAmount("");
      setSplitWith([]);
      fetchPurchases();
    } catch {
      setError("Failed to create purchase");
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await fetch(`${API_URL}/purchases/${id}`, { method: "DELETE" });
      fetchPurchases();
    } catch {
      console.error("Failed to delete purchase");
    }
  };

  const handleLeaveGroup = () => {
    setScreen("group");
    setGroupId(null);
    setGroupCode("");
    setCurrentUser("");
    setMembers([]);
    setPurchases([]);
  };

  // ==================== RENDER ====================

  if (screen === "group") {
    return (
      <div className="app">
        <h1>Splitter</h1>
        <div className="card centered">
          <h2>Enter Group Code</h2>
          <p className="subtitle">Join an existing group or create a new one with any code.</p>
          {groupError && <p className="error">{groupError}</p>}
          <form onSubmit={handleJoinGroup}>
            <input
              type="text"
              value={groupCode}
              onChange={(e) => setGroupCode(e.target.value)}
              placeholder="e.g. weekend-trip"
              autoFocus
            />
            <button type="submit" className="btn-primary">Join Group</button>
          </form>
        </div>
      </div>
    );
  }

  if (screen === "member") {
    return (
      <div className="app">
        <h1>Splitter</h1>
        <div className="card centered">
          <h2>Who are you?</h2>
          <p className="subtitle">
            Group: <strong>{groupCode}</strong>
          </p>

          {members.length > 0 && (
            <div className="member-list">
              {members.map((m) => (
                <button
                  key={m.id}
                  className="member-btn"
                  onClick={() => handleSelectMember(m.name)}
                >
                  {m.name}
                </button>
              ))}
            </div>
          )}

          {!showNewMember ? (
            <button
              className="btn-new-person"
              onClick={() => setShowNewMember(true)}
            >
              + I'm new here
            </button>
          ) : (
            <form onSubmit={handleCreateMember} className="new-member-form">
              {memberError && <p className="error">{memberError}</p>}
              <input
                type="text"
                value={newMemberName}
                onChange={(e) => setNewMemberName(e.target.value)}
                placeholder="Your name"
                autoFocus
              />
              <div className="new-member-actions">
                <button type="submit" className="btn-primary">Join</button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => {
                    setShowNewMember(false);
                    setNewMemberName("");
                    setMemberError("");
                  }}
                >
                  Cancel
                </button>
              </div>
            </form>
          )}

          <button className="btn-back" onClick={handleLeaveGroup}>
            &larr; Different group
          </button>
        </div>
      </div>
    );
  }

  // Main purchase screen
  return (
    <div className="app">
      <div className="top-bar">
        <h1>Splitter</h1>
        <div className="user-info">
          <span>
            <strong>{currentUser}</strong> in <strong>{groupCode}</strong>
          </span>
          <button className="btn-back" onClick={handleLeaveGroup}>Leave</button>
        </div>
      </div>

      <form className="purchase-form" onSubmit={handleSubmit}>
        <h2>New Purchase</h2>
        {error && <p className="error">{error}</p>}

        <label>
          Description
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g. Dinner at Joe's"
          />
        </label>

        <label>
          Amount ($)
          <input
            type="number"
            step="0.01"
            min="0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
          />
        </label>

        <div className="split-with-section">
          <label>Split with</label>
          <div className="split-with-chips">
            {members.map((m) => (
              <button
                key={m.id}
                type="button"
                className={`chip ${splitWith.includes(m.name) ? "chip-selected" : ""}`}
                onClick={() => toggleSplitWith(m.name)}
              >
                {m.name}
              </button>
            ))}
          </div>
        </div>

        <button type="submit" className="btn-primary">
          Add Purchase (paid by {currentUser})
        </button>
      </form>

      <div className="purchases-list">
        <h2>Purchases</h2>
        {purchases.length === 0 ? (
          <p className="empty">No purchases yet. Add one above!</p>
        ) : (
          purchases.map((p) => (
            <div key={p.id} className="purchase-card">
              <div className="purchase-header">
                <div>
                  <strong>{p.description}</strong>
                  <span className="amount">${Number(p.amount).toFixed(2)}</span>
                </div>
                <button
                  className="delete-btn"
                  onClick={() => handleDelete(p.id)}
                >
                  Delete
                </button>
              </div>
              <p className="paid-by">
                Paid by <strong>{p.paid_by}</strong>
              </p>
              <div className="splits">
                {p.splits.map((s, i) => (
                  <span key={i} className="split-chip">
                    {s.person}: ${Number(s.share_amount).toFixed(2)}
                  </span>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default App;
