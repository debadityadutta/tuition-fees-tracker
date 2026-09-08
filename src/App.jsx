import { useEffect, useMemo, useState } from 'react'
import {
  BookOpen,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Eye,
  GraduationCap,
  IndianRupee,
  LockKeyhole,
  LogIn,
  LogOut,
  Pencil,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
  UserPlus,
  UserRound,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react'
import { doc, getDoc, onSnapshot, setDoc } from 'firebase/firestore'
import {
  createOwnerAccount,
  db,
  ensureAnonymousUser,
  firebaseReady,
  getCurrentAuthUser,
  signInOwner,
  signOutUser,
  upgradeAnonymousOwner,
} from './firebase.js'

const VIEWER_NAMESPACE = 'teach-fees-tracker-v1'
const LEGACY_OWNER_WORKSPACE_KEY = 'teachFees.ownerWorkspace'
const LEGACY_OWNER_CODE_KEY = 'teachFees.ownerCode'

const todayIso = () => new Date().toISOString().slice(0, 10)

const defaultWorkspace = {
  ownerUid: 'local-owner',
  profile: { name: '' },
  teachers: [],
  payments: {},
  viewerCodeLength: 6,
  updatedAt: '',
}

function cleanWorkspace(data = {}) {
  return {
    ...defaultWorkspace,
    ...data,
    profile: { ...defaultWorkspace.profile, ...(data.profile || {}) },
    teachers: Array.isArray(data.teachers) ? data.teachers : [],
    payments: data.payments && typeof data.payments === 'object' ? data.payments : {},
  }
}

async function hashText(value) {
  const bytes = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

async function workspaceIdFromCode(code) {
  const hash = await hashText(`${VIEWER_NAMESPACE}:${code}`)
  return `tracker_${hash.slice(0, 32)}`
}

function monthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function teacherPaymentKey(teacherId, key) {
  return `${teacherId}__${key}`
}

function formatMonth(date) {
  return new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric' }).format(date)
}

function formatDate(dateString) {
  if (!dateString) return '—'
  const [y, m, d] = dateString.split('-').map(Number)
  if (!y || !m || !d) return dateString
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(y, m - 1, d))
}

function formatMoney(value) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(Number(value || 0))
}

function isTeacherActiveInMonth(teacher, date) {
  if (!teacher.joiningDate) return true
  const joining = teacher.joiningDate.slice(0, 7)
  return joining <= monthKey(date)
}

function monthDate(year, monthIndex) {
  return new Date(year, monthIndex, 1)
}

function Modal({ open, title, onClose, children }) {
  if (!open) return null
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section className="modal-card" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-button" onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        </div>
        {children}
      </section>
    </div>
  )
}

function Welcome({ onCreate, onLogin, onViewer }) {
  return (
    <main className="welcome-page">
      <section className="welcome-shell">
        <div className="brand-lockup">
          <img src="/icon-192.png" alt="Teach Fees Tracker logo" className="welcome-logo" />
          <div>
            <p className="eyebrow">PERSONAL FEE TRACKER</p>
            <h1>Teach Fees Tracker</h1>
            <p className="welcome-copy">Sign in with your name and date of birth to open your synced tracker on any device.</p>
          </div>
        </div>

        <div className="welcome-grid account-grid">
          <button className="welcome-action primary" onClick={onLogin}>
            <span className="action-icon"><LogIn size={24} /></span>
            <span>
              <strong>Sign in</strong>
              <small>Use your registered name and date of birth</small>
            </span>
          </button>

          <button className="welcome-action" onClick={onCreate}>
            <span className="action-icon"><UserPlus size={24} /></span>
            <span>
              <strong>Create account</strong>
              <small>Create a Firebase-synced tracker for the first time</small>
            </span>
          </button>

          <button className="welcome-action" onClick={onViewer}>
            <span className="action-icon"><Eye size={24} /></span>
            <span>
              <strong>Viewer mode</strong>
              <small>Enter the 4 or 6 digit code to view synced details only</small>
            </span>
          </button>
        </div>

        <div className="sync-note">
          {firebaseReady ? <Wifi size={18} /> : <WifiOff size={18} />}
          <span>{firebaseReady ? 'Firebase sync is connected.' : 'Firebase is not configured yet.'}</span>
        </div>
      </section>
    </main>
  )
}

export default function App() {
  const [booting, setBooting] = useState(true)
  const [mode, setMode] = useState('welcome')
  const [workspaceId, setWorkspaceId] = useState('')
  const [workspace, setWorkspace] = useState(cleanWorkspace())
  const [ownerDob, setOwnerDob] = useState('')
  const [ownerViewerCode, setOwnerViewerCode] = useState('')
  const [statusText, setStatusText] = useState('')
  const [error, setError] = useState('')
  const [currentMonth, setCurrentMonth] = useState(() => new Date())
  const [tab, setTab] = useState('month')
  const [createOpen, setCreateOpen] = useState(false)
  const [loginOpen, setLoginOpen] = useState(false)
  const [viewerOpen, setViewerOpen] = useState(false)
  const [teacherOpen, setTeacherOpen] = useState(false)
  const [editingTeacher, setEditingTeacher] = useState(null)
  const [saving, setSaving] = useState(false)
  const [syncNonce, setSyncNonce] = useState(0)

  const isOwner = mode === 'owner'
  const isViewer = mode === 'viewer'
  const currentKey = monthKey(currentMonth)

  async function loadOwnerFromSession() {
    setError('')

    if (!firebaseReady) {
      setMode('welcome')
      return false
    }

    try {
      const user = await getCurrentAuthUser()
      if (!user || user.isAnonymous) {
        setMode('welcome')
        return false
      }

      const accountSnap = await getDoc(doc(db, 'users', user.uid))
      if (!accountSnap.exists()) {
        setMode('welcome')
        return false
      }

      const account = accountSnap.data()
      if (!account.workspaceId) {
        setMode('welcome')
        return false
      }

      const workspaceSnap = await getDoc(doc(db, 'workspaces', account.workspaceId))
      if (!workspaceSnap.exists() || workspaceSnap.data().ownerUid !== user.uid) {
        setMode('welcome')
        return false
      }

      setWorkspaceId(account.workspaceId)
      setWorkspace(cleanWorkspace(workspaceSnap.data()))
      setOwnerDob(account.dob || '')
      setOwnerViewerCode(account.viewerCode || '')
      setMode('owner')
      return true
    } catch (loadError) {
      console.error(loadError)
      setError('Could not restore your Firebase account session.')
      setMode('welcome')
      return false
    }
  }

  useEffect(() => {
    let active = true
    ;(async () => {
      await loadOwnerFromSession()
      if (active) setBooting(false)
    })()
    return () => { active = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!firebaseReady || !workspaceId || !['owner', 'viewer'].includes(mode)) return

    const ref = doc(db, 'workspaces', workspaceId)
    const unsubscribe = onSnapshot(
      ref,
      (snap) => {
        if (snap.exists()) {
          setWorkspace(cleanWorkspace(snap.data()))
          setStatusText('Synced')
          window.setTimeout(() => setStatusText(''), 1200)
        }
      },
      (snapshotError) => {
        console.error(snapshotError)
        setError('Live sync stopped. Check your internet and Firebase setup.')
      },
    )
    return unsubscribe
  }, [mode, workspaceId, syncNonce])

  async function persist(nextWorkspace) {
    if (!firebaseReady || !workspaceId) {
      throw new Error('Firebase sync is not connected.')
    }

    const cleaned = cleanWorkspace({ ...nextWorkspace, updatedAt: new Date().toISOString() })
    setWorkspace(cleaned)
    await setDoc(doc(db, 'workspaces', workspaceId), cleaned, { merge: true })
  }

  async function createTracker({ name, dob, viewerCode }) {
    setSaving(true)
    setError('')
    try {
      if (!firebaseReady) throw new Error('Connect Firebase before creating an account.')
      if (!name.trim()) throw new Error('Enter your name.')
      if (!dob) throw new Error('Choose your date of birth.')
      if (!/^(?:\d{4}|\d{6})$/.test(viewerCode)) throw new Error('Viewer code must be exactly 4 or 6 digits.')

      const authUser = await ensureAnonymousUser()
      const legacyWorkspaceId = localStorage.getItem(LEGACY_OWNER_WORKSPACE_KEY)
      const legacyViewerCode = localStorage.getItem(LEGACY_OWNER_CODE_KEY)
      const requestedId = await workspaceIdFromCode(viewerCode)

      let id = requestedId
      let ref = doc(db, 'workspaces', id)
      let next
      let user
      const now = new Date().toISOString()

      // One-time upgrade path from the older anonymous-owner version.
      // This preserves the Firebase UID, so the existing Firestore workspace
      // keeps the same owner permissions.
      if (authUser?.isAnonymous && legacyWorkspaceId) {
        const legacyRef = doc(db, 'workspaces', legacyWorkspaceId)
        const legacySnap = await getDoc(legacyRef)
        if (legacySnap.exists() && legacySnap.data().ownerUid === authUser.uid) {
          const existingCode = legacyViewerCode || viewerCode
          const existingIdFromCode = await workspaceIdFromCode(existingCode)
          if (existingIdFromCode !== legacyWorkspaceId) {
            throw new Error('To upgrade your existing tracker, enter its current viewer code.')
          }

          user = await upgradeAnonymousOwner(name, dob)
          id = legacyWorkspaceId
          ref = legacyRef
          next = cleanWorkspace({
            ...legacySnap.data(),
            ownerUid: user.uid,
            profile: { name: name.trim() },
            updatedAt: now,
          })
          viewerCode = existingCode
        }
      }

      if (!user) {
        const existing = await getDoc(ref)
        if (existing.exists()) throw new Error('That viewer code is already in use. Choose another code.')

        user = await createOwnerAccount(name, dob)
        next = cleanWorkspace({
          ownerUid: user.uid,
          profile: { name: name.trim() },
          teachers: [],
          payments: {},
          viewerCodeLength: viewerCode.length,
          createdAt: now,
          updatedAt: now,
        })
      }

      await setDoc(ref, next)
      await setDoc(doc(db, 'users', user.uid), {
        workspaceId: id,
        name: name.trim(),
        dob,
        viewerCode,
        createdAt: now,
        updatedAt: now,
      })
      localStorage.removeItem(LEGACY_OWNER_WORKSPACE_KEY)
      localStorage.removeItem(LEGACY_OWNER_CODE_KEY)

      setWorkspaceId(id)
      setWorkspace(next)
      setOwnerDob(dob)
      setOwnerViewerCode(viewerCode)
      setMode('owner')
      setCreateOpen(false)
    } catch (createError) {
      console.error(createError)
      if (createError?.code === 'auth/email-already-in-use') {
        setError('An account with this name and date of birth already exists. Use Sign in.')
      } else {
        setError(createError.message || 'Could not create the tracker.')
      }
    } finally {
      setSaving(false)
    }
  }

  async function loginOwner({ name, dob }) {
    setSaving(true)
    setError('')
    try {
      if (!firebaseReady) throw new Error('Connect Firebase before signing in.')
      if (!name.trim()) throw new Error('Enter your registered name.')
      if (!dob) throw new Error('Choose your date of birth.')

      const user = await signInOwner(name, dob)
      const accountSnap = await getDoc(doc(db, 'users', user.uid))
      if (!accountSnap.exists()) throw new Error('Your account exists, but no tracker is linked to it.')

      const account = accountSnap.data()
      const workspaceSnap = await getDoc(doc(db, 'workspaces', account.workspaceId))
      if (!workspaceSnap.exists()) throw new Error('Your synced tracker could not be found.')
      if (workspaceSnap.data().ownerUid !== user.uid) throw new Error('This account is not the owner of that tracker.')

      setWorkspaceId(account.workspaceId)
      setWorkspace(cleanWorkspace(workspaceSnap.data()))
      setOwnerDob(account.dob || dob)
      setOwnerViewerCode(account.viewerCode || '')
      setMode('owner')
      setLoginOpen(false)
    } catch (loginError) {
      console.error(loginError)
      if (['auth/invalid-credential', 'auth/user-not-found', 'auth/wrong-password'].includes(loginError?.code)) {
        setError('Name or date of birth is incorrect.')
      } else {
        setError(loginError.message || 'Could not sign in.')
      }
    } finally {
      setSaving(false)
    }
  }

  async function openViewer(viewerCode) {
    setSaving(true)
    setError('')
    try {
      if (!/^(?:\d{4}|\d{6})$/.test(viewerCode)) throw new Error('Enter a valid 4 or 6 digit viewer code.')
      if (!firebaseReady) throw new Error('Viewer sync needs Firebase. Add your Firebase config first.')

      await ensureAnonymousUser()
      const id = await workspaceIdFromCode(viewerCode)
      const snap = await getDoc(doc(db, 'workspaces', id))
      if (!snap.exists()) throw new Error('No tracker was found for that code.')

      setWorkspaceId(id)
      setWorkspace(cleanWorkspace(snap.data()))
      setMode('viewer')
      setViewerOpen(false)
    } catch (viewerError) {
      setError(viewerError.message || 'Could not open viewer mode.')
    } finally {
      setSaving(false)
    }
  }

  async function leaveTracker() {
    if (isOwner) {
      try { await signOutUser() } catch (logoutError) { console.error(logoutError) }
    }
    setMode('welcome')
    setWorkspaceId('')
    setWorkspace(cleanWorkspace())
    setOwnerDob('')
    setOwnerViewerCode('')
    setError('')
  }

  async function addOrUpdateTeacher(form) {
    if (!isOwner) return
    setSaving(true)
    setError('')
    try {
      const fee = Number(form.monthlyFee)
      if (!form.name.trim()) throw new Error('Enter the teacher name.')
      if (!form.subject.trim()) throw new Error('Enter the subject.')
      if (!form.joiningDate) throw new Error('Choose the joining date.')
      if (!Number.isFinite(fee) || fee < 0) throw new Error('Enter a valid monthly fee.')

      let teachers
      if (editingTeacher) {
        teachers = workspace.teachers.map((teacher) =>
          teacher.id === editingTeacher.id
            ? { ...teacher, name: form.name.trim(), subject: form.subject.trim(), monthlyFee: fee, joiningDate: form.joiningDate }
            : teacher,
        )
      } else {
        teachers = [
          ...workspace.teachers,
          {
            id: crypto.randomUUID(),
            name: form.name.trim(),
            subject: form.subject.trim(),
            monthlyFee: fee,
            joiningDate: form.joiningDate,
          },
        ]
      }

      await persist({ ...workspace, teachers })
      setTeacherOpen(false)
      setEditingTeacher(null)
    } catch (teacherError) {
      setError(teacherError.message || 'Could not save teacher.')
    } finally {
      setSaving(false)
    }
  }

  async function deleteTeacher(teacher) {
    if (!isOwner) return
    if (!window.confirm(`Delete ${teacher.name} and all saved payment records for this teacher?`)) return

    setSaving(true)
    try {
      const teachers = workspace.teachers.filter((item) => item.id !== teacher.id)
      const payments = Object.fromEntries(
        Object.entries(workspace.payments).filter(([key]) => !key.startsWith(`${teacher.id}__`)),
      )
      await persist({ ...workspace, teachers, payments })
    } catch (deleteError) {
      setError(deleteError.message || 'Could not delete teacher.')
    } finally {
      setSaving(false)
    }
  }

  async function markPaid(teacher, paid) {
    if (!isOwner) return
    const key = teacherPaymentKey(teacher.id, currentKey)
    const payments = { ...workspace.payments }
    if (paid) {
      payments[key] = {
        paid: true,
        paidDate: payments[key]?.paidDate || todayIso(),
        amount: teacher.monthlyFee,
      }
    } else {
      delete payments[key]
    }
    try {
      await persist({ ...workspace, payments })
    } catch (paymentError) {
      setError(paymentError.message || 'Could not update payment.')
    }
  }

  async function changePaidDate(teacher, paidDate) {
    if (!isOwner) return
    const key = teacherPaymentKey(teacher.id, currentKey)
    if (!workspace.payments[key]) return
    const payments = {
      ...workspace.payments,
      [key]: { ...workspace.payments[key], paidDate },
    }
    try {
      await persist({ ...workspace, payments })
    } catch (paymentError) {
      setError(paymentError.message || 'Could not update paid date.')
    }
  }

  const activeTeachers = useMemo(
    () => workspace.teachers.filter((teacher) => isTeacherActiveInMonth(teacher, currentMonth)),
    [workspace.teachers, currentMonth],
  )

  const totals = useMemo(() => {
    let total = 0
    let paid = 0
    for (const teacher of activeTeachers) {
      total += Number(teacher.monthlyFee || 0)
      const payment = workspace.payments[teacherPaymentKey(teacher.id, currentKey)]
      if (payment?.paid) paid += Number(payment.amount ?? teacher.monthlyFee ?? 0)
    }
    return { total, paid, remaining: Math.max(0, total - paid) }
  }, [activeTeachers, workspace.payments, currentKey])

  if (booting) {
    return (
      <main className="loading-page">
        <img src="/icon-192.png" alt="" className="loading-logo" />
        <div className="spinner" />
        <p>Opening Teach Fees Tracker…</p>
      </main>
    )
  }

  if (mode === 'welcome') {
    return (
      <>
        <Welcome
          onLogin={() => { setError(''); setLoginOpen(true) }}
          onCreate={() => { setError(''); setCreateOpen(true) }}
          onViewer={() => { setError(''); setViewerOpen(true) }}
        />
        <LoginModal open={loginOpen} saving={saving} error={error} onClose={() => setLoginOpen(false)} onSubmit={loginOwner} />
        <SetupModal open={createOpen} saving={saving} error={error} onClose={() => setCreateOpen(false)} onSubmit={createTracker} />
        <ViewerModal open={viewerOpen} saving={saving} error={error} onClose={() => setViewerOpen(false)} onSubmit={openViewer} />
      </>
    )
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-brand">
          <img src="/icon-192.png" alt="Teach Fees Tracker" />
          <div>
            <p className="eyebrow">PERSONAL FEE TRACKER</p>
            <h1>Teach Fees Tracker</h1>
          </div>
        </div>
        <div className="topbar-actions">
          <span className={`mode-pill ${isViewer ? 'viewer' : 'owner'}`}>
            {isViewer ? <Eye size={15} /> : <ShieldCheck size={15} />}
            {isViewer ? 'View only' : 'Owner'}
          </span>
          <button className="icon-button" title="Refresh sync" onClick={() => setSyncNonce((n) => n + 1)}>
            <RefreshCw size={19} />
          </button>
          <button className="icon-button" title={isOwner ? 'Log out' : 'Exit viewer'} onClick={leaveTracker}>
            <LogOut size={19} />
          </button>
        </div>
      </header>

      <main className="content">
        <section className="profile-strip">
          <div className="profile-main">
            <span className="profile-avatar"><UserRound size={24} /></span>
            <div>
              <strong>{workspace.profile.name || 'Teach Fees Tracker'}</strong>
              <span>{isOwner && ownerDob ? `DOB ${formatDate(ownerDob)}` : isViewer ? 'Synced viewer access' : 'Firebase account'}</span>
            </div>
          </div>
          <div className="profile-meta">
            <span>{firebaseReady ? <Wifi size={16} /> : <WifiOff size={16} />}{firebaseReady ? 'Firebase sync' : 'Not connected'}</span>
            {isOwner && ownerViewerCode && (
              <span><LockKeyhole size={16} />Viewer code: {ownerViewerCode}</span>
            )}
          </div>
        </section>

        {error && <div className="alert error">{error}</div>}
        {statusText && <div className="toast">{statusText}</div>}

        <section className="month-toolbar">
          <button className="month-arrow" onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1))}>
            <ChevronLeft size={22} />
          </button>
          <div className="month-title">
            <CalendarDays size={20} />
            <div>
              <small>Fee month</small>
              <strong>{formatMonth(currentMonth)}</strong>
            </div>
          </div>
          <button className="month-arrow" onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1))}>
            <ChevronRight size={22} />
          </button>
        </section>

        <section className="summary-grid">
          <SummaryCard label="Total fees" value={formatMoney(totals.total)} icon={<IndianRupee size={22} />} />
          <SummaryCard label="Paid" value={formatMoney(totals.paid)} icon={<CheckCircle2 size={22} />} tone="success" />
          <SummaryCard label="Remaining" value={formatMoney(totals.remaining)} icon={<CalendarDays size={22} />} tone="danger" />
          <SummaryCard label="Teachers" value={activeTeachers.length} icon={<GraduationCap size={22} />} />
        </section>

        <section className="ledger-card">
          <div className="ledger-head">
            <div>
              <p className="eyebrow">TUITION LEDGER</p>
              <h2>{tab === 'month' ? `${formatMonth(currentMonth)} payments` : `${currentMonth.getFullYear()} overview`}</h2>
            </div>
            {isOwner && (
              <button className="primary-button" onClick={() => { setEditingTeacher(null); setTeacherOpen(true) }}>
                <Plus size={18} /> Add teacher
              </button>
            )}
          </div>

          <div className="tabs">
            <button className={tab === 'month' ? 'active' : ''} onClick={() => setTab('month')}>Monthly view</button>
            <button className={tab === 'year' ? 'active' : ''} onClick={() => setTab('year')}>Year overview</button>
          </div>

          {workspace.teachers.length === 0 ? (
            <div className="empty-state">
              <span><BookOpen size={28} /></span>
              <h3>0 teachers in your ledger</h3>
              <p>{isOwner ? 'Add your first teacher to start tracking monthly fees.' : 'The owner has not added any teachers yet.'}</p>
              {isOwner && <button className="primary-button" onClick={() => setTeacherOpen(true)}><Plus size={18} /> Add teacher</button>}
            </div>
          ) : tab === 'month' ? (
            <div className="teacher-list">
              {workspace.teachers.map((teacher) => (
                <TeacherRow
                  key={teacher.id}
                  teacher={teacher}
                  currentMonth={currentMonth}
                  payment={workspace.payments[teacherPaymentKey(teacher.id, currentKey)]}
                  isOwner={isOwner}
                  onPaid={(paid) => markPaid(teacher, paid)}
                  onPaidDate={(date) => changePaidDate(teacher, date)}
                  onEdit={() => { setEditingTeacher(teacher); setTeacherOpen(true) }}
                  onDelete={() => deleteTeacher(teacher)}
                />
              ))}
            </div>
          ) : (
            <YearOverview year={currentMonth.getFullYear()} teachers={workspace.teachers} payments={workspace.payments} />
          )}
        </section>

        {isViewer && (
          <section className="viewer-banner">
            <Eye size={22} />
            <div>
              <strong>Viewer-only mode</strong>
              <span>You can see all teacher and payment details, but this device cannot add, edit, delete, or change payment status.</span>
            </div>
          </section>
        )}
      </main>

      <TeacherModal
        open={teacherOpen}
        teacher={editingTeacher}
        saving={saving}
        error={error}
        onClose={() => { setTeacherOpen(false); setEditingTeacher(null); setError('') }}
        onSubmit={addOrUpdateTeacher}
      />
    </div>
  )
}

function SummaryCard({ label, value, icon, tone = '' }) {
  return (
    <article className={`summary-card ${tone}`}>
      <span className="summary-icon">{icon}</span>
      <div>
        <small>{label}</small>
        <strong>{value}</strong>
      </div>
    </article>
  )
}

function TeacherRow({ teacher, currentMonth, payment, isOwner, onPaid, onPaidDate, onEdit, onDelete }) {
  const active = isTeacherActiveInMonth(teacher, currentMonth)
  return (
    <article className={`teacher-row ${!active ? 'not-started' : ''}`}>
      <div className="teacher-info">
        <div className="teacher-avatar"><GraduationCap size={22} /></div>
        <div className="teacher-copy">
          <div className="teacher-name-line">
            <h3>{teacher.name}</h3>
            {!active && <span className="status-chip neutral">Not started</span>}
          </div>
          <p>{teacher.subject} · {formatMoney(teacher.monthlyFee)}/month</p>
          <span className="joining"><CalendarDays size={14} /> Joined {formatDate(teacher.joiningDate)}</span>
        </div>
      </div>

      <div className="payment-area">
        {active ? (
          <>
            <button
              className={`payment-toggle ${payment?.paid ? 'paid' : 'unpaid'}`}
              onClick={() => isOwner && onPaid(!payment?.paid)}
              disabled={!isOwner}
              title={isOwner ? 'Change payment status' : 'View only'}
            >
              {payment?.paid ? <CheckCircle2 size={18} /> : <CalendarDays size={18} />}
              {payment?.paid ? 'Paid' : 'Unpaid'}
            </button>
            {payment?.paid ? (
              <label className="paid-date">
                <span>Paid date</span>
                {isOwner ? (
                  <input type="date" value={payment.paidDate || ''} onChange={(event) => onPaidDate(event.target.value)} />
                ) : (
                  <strong>{formatDate(payment.paidDate)}</strong>
                )}
              </label>
            ) : (
              <span className="due-text">{formatMoney(teacher.monthlyFee)} due</span>
            )}
          </>
        ) : (
          <span className="due-text">No fee for this month</span>
        )}
      </div>

      {isOwner && (
        <div className="row-actions">
          <button className="icon-button" onClick={onEdit} title="Edit teacher"><Pencil size={17} /></button>
          <button className="icon-button danger" onClick={onDelete} title="Delete teacher"><Trash2 size={17} /></button>
        </div>
      )}
    </article>
  )
}

function YearOverview({ year, teachers, payments }) {
  const months = Array.from({ length: 12 }, (_, index) => monthDate(year, index))
  return (
    <div className="year-table-wrap">
      <table className="year-table">
        <thead>
          <tr>
            <th>Teacher</th>
            {months.map((date) => <th key={date.getMonth()}>{date.toLocaleString('en-IN', { month: 'short' })}</th>)}
          </tr>
        </thead>
        <tbody>
          {teachers.map((teacher) => (
            <tr key={teacher.id}>
              <td>
                <strong>{teacher.name}</strong>
                <small>{teacher.subject}</small>
              </td>
              {months.map((date) => {
                const active = isTeacherActiveInMonth(teacher, date)
                const payment = payments[teacherPaymentKey(teacher.id, monthKey(date))]
                return (
                  <td key={date.getMonth()}>
                    <span className={`year-dot ${!active ? 'na' : payment?.paid ? 'paid' : 'unpaid'}`} title={!active ? 'Not started' : payment?.paid ? `Paid ${formatDate(payment.paidDate)}` : 'Unpaid'}>
                      {!active ? '—' : payment?.paid ? '✓' : '•'}
                    </span>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function LoginModal({ open, saving, error, onClose, onSubmit }) {
  const [name, setName] = useState('')
  const [dob, setDob] = useState('')

  useEffect(() => {
    if (open) {
      setName('')
      setDob('')
    }
  }, [open])

  return (
    <Modal open={open} title="Sign in to your tracker" onClose={onClose}>
      <form className="form-stack" onSubmit={(event) => { event.preventDefault(); onSubmit({ name, dob }) }}>
        <div className="viewer-modal-icon"><LogIn size={28} /></div>
        <p className="form-intro">Use the same name and date of birth you registered with. Your Firebase account will open the same synced tracker on this device.</p>
        <label>
          <span>Registered name</span>
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Enter your name" autoComplete="name" />
        </label>
        <label>
          <span>Date of birth</span>
          <input type="date" value={dob} onChange={(event) => setDob(event.target.value)} />
        </label>
        {error && <div className="alert error">{error}</div>}
        <button className="primary-button full" disabled={saving}>{saving ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </Modal>
  )
}

function SetupModal({ open, saving, error, onClose, onSubmit }) {
  const [name, setName] = useState('')
  const [dob, setDob] = useState('')
  const [viewerCode, setViewerCode] = useState('')

  useEffect(() => {
    if (open) {
      setName('')
      setDob('')
      setViewerCode('')
    }
  }, [open])

  return (
    <Modal open={open} title="Create Firebase account" onClose={onClose}>
      <form className="form-stack" onSubmit={(event) => { event.preventDefault(); onSubmit({ name, dob, viewerCode }) }}>
        <label>
          <span>Your name</span>
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Enter your name" autoComplete="name" />
        </label>
        <label>
          <span>Date of birth</span>
          <input type="date" value={dob} onChange={(event) => setDob(event.target.value)} />
        </label>
        <label>
          <span>Viewer-only code</span>
          <input inputMode="numeric" maxLength={6} value={viewerCode} onChange={(event) => setViewerCode(event.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="4 or 6 digits" />
          <small>Use 6 digits for better privacy. Share this code only with people who should view your fee records.</small>
        </label>
        {error && <div className="alert error">{error}</div>}
        <button className="primary-button full" disabled={saving}>{saving ? 'Creating…' : 'Create tracker'}</button>
      </form>
    </Modal>
  )
}

function ViewerModal({ open, saving, error, onClose, onSubmit }) {
  const [viewerCode, setViewerCode] = useState('')

  useEffect(() => {
    if (open) setViewerCode('')
  }, [open])

  return (
    <Modal open={open} title="Open viewer mode" onClose={onClose}>
      <form className="form-stack" onSubmit={(event) => { event.preventDefault(); onSubmit(viewerCode) }}>
        <div className="viewer-modal-icon"><Eye size={28} /></div>
        <p className="form-intro">Enter the code created by the owner. This opens all synced details in read-only mode.</p>
        <label>
          <span>Viewer code</span>
          <input className="code-input" inputMode="numeric" maxLength={6} value={viewerCode} onChange={(event) => setViewerCode(event.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="••••••" autoFocus />
        </label>
        {error && <div className="alert error">{error}</div>}
        <button className="primary-button full" disabled={saving}>{saving ? 'Opening…' : 'View tracker'}</button>
      </form>
    </Modal>
  )
}

function TeacherModal({ open, teacher, saving, error, onClose, onSubmit }) {
  const [name, setName] = useState('')
  const [subject, setSubject] = useState('')
  const [monthlyFee, setMonthlyFee] = useState('')
  const [joiningDate, setJoiningDate] = useState(todayIso())

  useEffect(() => {
    if (!open) return
    setName(teacher?.name || '')
    setSubject(teacher?.subject || '')
    setMonthlyFee(teacher?.monthlyFee ?? '')
    setJoiningDate(teacher?.joiningDate || todayIso())
  }, [open, teacher])

  return (
    <Modal open={open} title={teacher ? 'Edit teacher' : 'Add teacher'} onClose={onClose}>
      <form className="form-stack" onSubmit={(event) => { event.preventDefault(); onSubmit({ name, subject, monthlyFee, joiningDate }) }}>
        <label>
          <span>Teacher name</span>
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Teacher name" />
        </label>
        <label>
          <span>Subject</span>
          <input value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="e.g. Mathematics" />
        </label>
        <label>
          <span>Monthly fee (₹)</span>
          <input type="number" min="0" step="1" value={monthlyFee} onChange={(event) => setMonthlyFee(event.target.value)} placeholder="1500" />
        </label>
        <label>
          <span>Joining date</span>
          <input type="date" value={joiningDate} onChange={(event) => setJoiningDate(event.target.value)} />
        </label>
        {error && <div className="alert error">{error}</div>}
        <button className="primary-button full" disabled={saving}>{saving ? 'Saving…' : teacher ? 'Save changes' : 'Add teacher'}</button>
      </form>
    </Modal>
  )
}
