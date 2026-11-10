import axios from 'axios'

const api = axios.create({
  baseURL: '/api',
  timeout: 60000,
})

api.interceptors.response.use(
  r => r.data,
  err => Promise.reject(err?.response?.data || err)
)

// Invoices
export const uploadInvoices = (files) => {
  const fd = new FormData()
  files.forEach(f => fd.append('invoices', f))
  return api.post('/invoices/upload', fd)
}
export const getBatchStatus   = (batchId) => api.get(`/invoices/batch/${batchId}`)
export const listBatches      = ()        => api.get('/invoices/batches').then(d => d.batches ?? d)
export const getInvoiceStats  = ()        => api.get('/invoices/stats').then(d => d.stats ?? d)
export const listInvoices     = (params)  => api.get('/invoices', { params }).then(d => d.invoices ?? d)
export const getInvoice       = (id)      => api.get(`/invoices/${id}`).then(d => d.invoice ?? d)
export const updateInvoice    = (id, data) => api.put(`/invoices/${id}`, data).then(d => d.invoice ?? d)
export const confirmInvoice   = (id)      => api.post(`/invoices/${id}/confirm`)
export const deleteInvoice    = (id)      => api.delete(`/invoices/${id}`)

// Statements
export const uploadStatement  = (files, batchId) => {
  const fd = new FormData()
  const list = Array.isArray(files) ? files : [files]
  list.forEach(f => {
    fd.append('statements', f)
    fd.append('statement', f)
  })
  if (batchId) fd.append('batchId', batchId)
  return api.post('/statements/upload', fd)
}
export const uploadStatements = uploadStatement

export const listStatements   = ()   => api.get('/statements').then(d => d.statements ?? d)
export const getStatement     = (id) => api.get(`/statements/${id}`).then(d => d.statement ?? d)
export const deleteStatement  = (id) => api.delete(`/statements/${id}`)

// Validation
export const runValidation       = (data)       => api.post('/validation/run', data)
export const getValidationResult = (invoiceId)  => api.get(`/validation/invoice/${invoiceId}`).then(d => d.result ?? d)
export const overrideValidation  = (invoiceId, data) => api.post(`/validation/invoice/${invoiceId}/override`, data)

// Auth / PIN
export const getAuthStatus       = ()          => api.get('/auth/status')
export const verifyPin           = (pin)       => api.post('/auth/verify-pin', { pin })

export default api
