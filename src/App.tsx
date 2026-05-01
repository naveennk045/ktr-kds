import { Navigate, Route, Routes } from "react-router-dom";
import Setup from "./routes/Setup";
import KdsBoard from "./routes/KdsBoard";
import TmsBoard from "./routes/TmsBoard";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Setup />} />
      <Route path="/kds" element={<KdsBoard />} />
      <Route path="/tms" element={<TmsBoard />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
