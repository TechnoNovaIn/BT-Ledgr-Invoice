import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/layout/Layout'
import DashboardPage from './pages/DashboardPage'
import UploadPage from './pages/UploadPage'
import InvoicesPage from './pages/InvoicesPage'
import InvoiceDetailPage from './pages/InvoiceDetailPage'
import StatementsPage from './pages/StatementsPage'
import ValidationPage from './pages/ValidationPage'
import { ToastProvider } from './components/ui/Toast'

export default function App() {
  return (
    <ToastProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<Navigate to="/dashboard" replace />} />
            <Route path="dashboard" element={<DashboardPage />} />
            <Route path="upload" element={<UploadPage />} />
            <Route path="invoices" element={<InvoicesPage />} />
            <Route path="invoices/:id" element={<InvoiceDetailPage />} />
            <Route path="statements" element={<StatementsPage />} />
            <Route path="validate" element={<ValidationPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </ToastProvider>
  )
}
