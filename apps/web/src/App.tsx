import { Navigate, Route, Routes } from 'react-router-dom';
import Layout from './components/Layout.js';
import SetupWizard from './pages/SetupWizard.js';
import TasksPage from './pages/TasksPage.js';
import WhiteboardPage from './pages/WhiteboardPage.js';

export default function App() {
  return (
    <Routes>
      <Route path="/setup" element={<SetupWizard />} />
      <Route element={<Layout />}>
        <Route index element={<Navigate to="/tasks" replace />} />
        <Route path="/today" element={<Navigate to="/tasks?view=today" replace />} />
        <Route path="/tasks" element={<TasksPage />} />
        <Route path="/whiteboard" element={<WhiteboardPage />} />
        <Route path="/calendar" element={<Navigate to="/tasks?view=calendar" replace />} />
        <Route path="/habits" element={<Navigate to="/tasks?view=habits" replace />} />
        <Route path="/objectives" element={<Navigate to="/tasks?view=objectives" replace />} />
        <Route path="/goals" element={<Navigate to="/tasks?view=goals" replace />} />
        <Route path="/review" element={<Navigate to="/tasks?view=review" replace />} />
        <Route path="/analytics" element={<Navigate to="/tasks?view=analytics" replace />} />
        <Route path="/settings" element={<Navigate to="/tasks?view=settings" replace />} />
        <Route path="*" element={<Navigate to="/tasks" replace />} />
      </Route>
    </Routes>
  );
}
