import { Navigate, Route, Routes, useParams } from 'react-router-dom';
import Layout from './components/Layout.js';
import { TaskContextMenuProvider } from './components/tasks/TaskContextMenu.js';
import SetupWizard from './pages/SetupWizard.js';
import SharedNotePage from './pages/SharedNotePage.js';
import TasksPage from './pages/TasksPage.js';
import WhiteboardPage from './pages/WhiteboardPage.js';
import SecondBrainPage from './pages/SecondBrainPage.js';
import WishlistPage from './pages/WishlistPage.js';
import WorkoutPage from './pages/WorkoutPage.js';
import { decodeNoteDeepLinkId } from './lib/noteDeepLinks.js';
import { CommandPaletteProvider } from './lib/commandPalette.js';

function NoteDeepLink() {
  const { id = '' } = useParams();
  const notePath = decodeNoteDeepLinkId(id);
  return <Navigate to={notePath ? `/notes?note=${encodeURIComponent(notePath)}` : '/notes'} replace />;
}

function PlanDeepLink() {
  const { blockId = '' } = useParams();
  return <Navigate to={`/tasks?view=calendar&block=${encodeURIComponent(blockId)}`} replace />;
}

export default function App() {
  return (
    <TaskContextMenuProvider>
      <CommandPaletteProvider>
        <Routes>
          <Route path="/setup" element={<SetupWizard />} />
          <Route path="/share/:token" element={<SharedNotePage />} />
          <Route path="/note/:id" element={<NoteDeepLink />} />
          <Route path="/plan/:blockId" element={<PlanDeepLink />} />
          <Route element={<Layout />}>
            <Route index element={<Navigate to="/tasks" replace />} />
            <Route path="/today" element={<Navigate to="/tasks?view=today" replace />} />
            <Route path="/tasks" element={<TasksPage />} />
            <Route path="/whiteboard" element={<WhiteboardPage />} />
            <Route path="/notes" element={<SecondBrainPage />} />
            <Route path="/wishlist" element={<WishlistPage />} />
            <Route path="/workout" element={<WorkoutPage />} />
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
      </CommandPaletteProvider>
    </TaskContextMenuProvider>
  );
}
