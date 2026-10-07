'use client'

import { useState } from 'react'
import { trpc } from '@/lib/trpc-client'
import { Button } from '@/shared/components/ui/button'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { MutationDialog } from '@/shared/components/MutationDialog'
import { useMutationFlow } from '@/shared/hooks/useMutationFlow'
import { cn } from '@/lib/utils'
import { Receipt, Plus, Trash2 } from 'lucide-react'
import { format } from 'date-fns'

interface RecordSaleButtonProps {
  facilityId: string
  onSuccess?: () => void
}

interface TransactionEntry {
  packageLabel: string
  quantity: string
  unitOfMeasure: string
  totalAmount: string
}

export function RecordSaleButton({ facilityId, onSuccess }: RecordSaleButtonProps) {
  const [salesDate, setSalesDate] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [customerType, setCustomerType] = useState('Consumer')
  const [patientLicense, setPatientLicense] = useState('')
  const [transactions, setTransactions] = useState<TransactionEntry[]>([
    { packageLabel: '', quantity: '', unitOfMeasure: 'Each', totalAmount: '' },
  ])

  const utils = trpc.useUtils()
  const mutation = trpc.sales.createSalesReceipt.useMutation()

  type PreviewData = {
    salesDate: string
    salesCustomerType: string
    transactionCount: number
    totalAmount: number
    transactions: Array<{ packageLabel: string; itemName: string; quantity: number; unitOfMeasure: string; totalAmount: number }>
  }

  const flow = useMutationFlow<
    Parameters<typeof mutation.mutateAsync>[0],
    PreviewData
  >({
    mutationFn: (input) => mutation.mutateAsync(input),
    getPreview: (result) => {
      const r = result as { preview: PreviewData }
      return [r.preview]
    },
    onSuccess: () => {
      utils.sales.getMetrcReceipts.invalidate()
      utils.sales.getMetrcSalesSummary.invalidate()
      resetForm()
      onSuccess?.()
    },
  })

  const resetForm = () => {
    setSalesDate(format(new Date(), 'yyyy-MM-dd'))
    setCustomerType('Consumer')
    setPatientLicense('')
    setTransactions([{ packageLabel: '', quantity: '', unitOfMeasure: 'Each', totalAmount: '' }])
  }

  const handleOpen = () => {
    resetForm()
    flow.open()
  }

  const addTransaction = () => {
    setTransactions(prev => [...prev, { packageLabel: '', quantity: '', unitOfMeasure: 'Each', totalAmount: '' }])
  }

  const removeTransaction = (index: number) => {
    setTransactions(prev => prev.filter((_, i) => i !== index))
  }

  const updateTransaction = (index: number, field: keyof TransactionEntry, value: string) => {
    setTransactions(prev => prev.map((t, i) => i === index ? { ...t, [field]: value } : t))
  }

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (transactions.some(t => !t.packageLabel || !t.quantity || !t.totalAmount)) return

    flow.preview({
      facilityId,
      salesDate,
      salesCustomerType: customerType,
      ...(patientLicense ? { patientLicenseNumber: patientLicense } : {}),
      transactions: transactions.map(t => ({
        packageLabel: t.packageLabel,
        quantity: parseFloat(t.quantity),
        unitOfMeasure: t.unitOfMeasure,
        totalAmount: parseFloat(t.totalAmount),
      })),
    })
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={handleOpen}>
        <Receipt className="h-4 w-4 mr-1" />
        Record Sale
      </Button>

      <MutationDialog
        title="Record Metrc Sales Receipt"
        description="Create a new sales receipt in Metrc"
        flow={flow}
        size="lg"
        formContent={
          <form id="mutation-form" onSubmit={handleFormSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="salesDate">Sales Date</Label>
                <Input id="salesDate" type="date" value={salesDate} onChange={(e) => setSalesDate(e.target.value)} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="customerType">Customer Type</Label>
                <select
                  id="customerType"
                  value={customerType}
                  onChange={(e) => setCustomerType(e.target.value)}
                  className={cn(
                    'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm',
                    'ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
                  )}
                >
                  <option value="Consumer">Consumer</option>
                  <option value="Patient">Patient</option>
                  <option value="Caregiver">Caregiver</option>
                </select>
              </div>
            </div>

            {customerType === 'Patient' && (
              <div className="space-y-2">
                <Label htmlFor="patientLicense">Patient License #</Label>
                <Input id="patientLicense" value={patientLicense} onChange={(e) => setPatientLicense(e.target.value)} placeholder="License number..." required />
              </div>
            )}

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Line Items</Label>
                <Button type="button" variant="ghost" size="sm" onClick={addTransaction}>
                  <Plus className="h-3.5 w-3.5 mr-1" /> Add Item
                </Button>
              </div>
              <div className="space-y-2">
                {transactions.map((t, i) => (
                  <div key={i} className="grid grid-cols-[1fr_80px_100px_100px_32px] gap-2 items-end">
                    <div className="space-y-1">
                      {i === 0 && <span className="text-xs text-muted-foreground">Package Label</span>}
                      <Input
                        value={t.packageLabel}
                        onChange={(e) => updateTransaction(i, 'packageLabel', e.target.value)}
                        placeholder="1A400..."
                        required
                      />
                    </div>
                    <div className="space-y-1">
                      {i === 0 && <span className="text-xs text-muted-foreground">Qty</span>}
                      <Input
                        type="number"
                        step="0.01"
                        min="0.01"
                        value={t.quantity}
                        onChange={(e) => updateTransaction(i, 'quantity', e.target.value)}
                        required
                      />
                    </div>
                    <div className="space-y-1">
                      {i === 0 && <span className="text-xs text-muted-foreground">Unit</span>}
                      <select
                        value={t.unitOfMeasure}
                        onChange={(e) => updateTransaction(i, 'unitOfMeasure', e.target.value)}
                        className={cn(
                          'flex h-10 w-full rounded-md border border-input bg-background px-2 py-2 text-sm',
                          'ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
                        )}
                      >
                        <option value="Each">Each</option>
                        <option value="Grams">Grams</option>
                        <option value="Ounces">Ounces</option>
                      </select>
                    </div>
                    <div className="space-y-1">
                      {i === 0 && <span className="text-xs text-muted-foreground">Total ($)</span>}
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        value={t.totalAmount}
                        onChange={(e) => updateTransaction(i, 'totalAmount', e.target.value)}
                        required
                      />
                    </div>
                    <div>
                      {transactions.length > 1 && (
                        <Button type="button" variant="ghost" size="icon" className="h-10 w-8" onClick={() => removeTransaction(i)}>
                          <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </form>
        }
        previewContent={(previews) => {
          const p = previews[0]!
          return (
            <div className="space-y-3">
              <div className="rounded-md border border-border bg-muted/30 p-4 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Sales Date</span>
                  <span>{p.salesDate}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Customer Type</span>
                  <span>{p.salesCustomerType}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Line Items</span>
                  <span>{p.transactionCount}</span>
                </div>
                <div className="flex justify-between text-sm border-t border-border pt-2">
                  <span className="text-muted-foreground">Total Amount</span>
                  <span className="font-bold text-emerald-500">${p.totalAmount.toFixed(2)}</span>
                </div>
                <div className="border-t border-border pt-2 mt-2 space-y-1">
                  {p.transactions.map((t, i) => (
                    <div key={i} className="flex justify-between text-sm">
                      <div>
                        <span className="font-mono text-xs">{t.packageLabel}</span>
                        <span className="text-muted-foreground ml-2">{t.itemName}</span>
                      </div>
                      <span>{t.quantity} {t.unitOfMeasure} &middot; ${t.totalAmount.toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )
        }}
        confirmLabel="Record Sale"
      />
    </>
  )
}
