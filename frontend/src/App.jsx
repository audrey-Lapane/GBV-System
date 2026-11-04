import { Link, Route, Routes, useLocation } from "react-router-dom";
import { TopBar, ProtectedRoute } from "./components/ui.jsx";
import { IconReport, IconShield, IconBuilding, IconArrow } from "./components/icons.jsx";
import Report from "./pages/reporter/Report.jsx";
import Submitted from "./pages/reporter/Submitted.jsx";
import Portal from "./pages/reporter/Portal.jsx";
import { Login, Register } from "./pages/institution/Login.jsx";
import Dashboard from "./pages/institution/Dashboard.jsx";
import ReportView from "./pages/institution/ReportView.jsx";
import Admin from "./pages/admin/Admin.jsx";

function Home() {
  return (
    <div className="wide">
      <section className="hero">
        <h1>Report Gender-Based Violence safely and anonymously</h1>
        <p>This platform lets victims and witnesses of gender-based violence report an incident without revealing who they are. Your report is encrypted, your identity is never collected, and you decide which institution may see your report. You can withdraw that permission at any time, and every access to your report is permanently recorded where no one can erase it.</p>
      </section>

      <div className="cards">
        <Link className="card blue" to="/report">
          <span className="tile blue"><IconReport /></span>
          <h2>Make a report</h2>
          <p>Four steps, of which only two are required: what happened, optional details, optional evidence, and who may read it.</p>
          <span className="go">No account needed <IconArrow /></span>
        </Link>
        <Link className="card green" to="/my">
          <span className="tile green"><IconShield /></span>
          <h2>Open my report</h2>
          <p>See who can read it, approve or deny requests, add more, and take access back whenever you want.</p>
          <span className="go">Report ID and secret <IconArrow /></span>
        </Link>
        <Link className="card violet" to="/staff/login">
          <span className="tile violet"><IconBuilding /></span>
          <h2>Staff sign in</h2>
          <p>For the GBV office, legal services, campus health and social workers. Every access is recorded against your staff number.</p>
          <span className="go">Sign in required <IconArrow /></span>
        </Link>
      </div>

      <section className="steps-strip">
        <h2>How your report is handled</h2>
        <ol className="strip">
          <li><span className="n">1</span><strong>You send it</strong><span>Without your name, from any browser</span></li>
          <li><span className="n">2</span><strong>It is locked</strong><span>Encrypted before it is stored</span></li>
          <li><span className="n">3</span><strong>You decide</strong><span>Who reads it, which parts, for how long</span></li>
          <li><span className="n">4</span><strong>They ask</strong><span>Staff request, you approve or deny</span></li>
          <li><span className="n">5</span><strong>It is recorded</strong><span>Every attempt, permanently</span></li>
        </ol>
      </section>

      <p className="footer-links">
        If you are in danger now, call GBV Command Centre 24hr helpline : 0800 428 428 | SAPS emergency: 10111. Press <kbd>Esc</kbd> or use Leave now at any time to go to another site.
      </p>
    </div>
  );
}

function NotFound() {
  return <div className="narrow"><h1>Page not found</h1><p><Link to="/">Go to the start</Link></p></div>;
}

export default function App() {
  const { pathname } = useLocation();
  const area = pathname.startsWith("/staff") || pathname.startsWith("/admin") ? "staff" : "reporter";
  return (
    <>
      <a href="#main" className="sr-only">Skip to content</a>
            <TopBar area={area} />
      <p className="helpline">
        <span className="item">GBV Command Centre 24hr helpline: <a href="tel:0800428428">0800&nbsp;428&nbsp;428</a></span>
        <span className="sep" aria-hidden="true">|</span>
        <span className="item">SAPS emergency: <a href="tel:10111">10111</a></span>
      </p>
      <main id="main">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/report" element={<Report />} />
          <Route path="/submitted" element={<Submitted />} />
          <Route path="/my" element={<Portal />} />
          <Route path="/staff/login" element={<Login />} />
          <Route path="/staff/register" element={<Register />} />
          <Route path="/staff" element={<ProtectedRoute roles={["gbv_office", "legal", "health", "social_worker"]}><Dashboard /></ProtectedRoute>} />
          <Route path="/staff/report/:id" element={<ProtectedRoute roles={["gbv_office", "legal", "health", "social_worker"]}><ReportView /></ProtectedRoute>} />
          <Route path="/admin" element={<ProtectedRoute roles={["admin"]}><Admin /></ProtectedRoute>} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
    </>
  );
}
