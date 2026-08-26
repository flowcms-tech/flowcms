'use client'

import { useCallback, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import ElementTable from '@/components/shared/ElementTable/ElementTable'
import ElementButton from '@/components/shared/ElementButton/ElementButton'
import ElementModal from '@/components/shared/ElementModal/ElementModal'
import { BlogPostFaqServices } from '../Services/BlogPostFaqServices'
import { buildFaqColumns } from '../Values/FaqValues'
import PostFaqDrawer from './PostFaqDrawer'
import type { BlogPostFaq, BlogPostFaqDraft } from '../Types'
import type { CreateFaqFormValues } from '../Values/FaqValidations'

interface PostFaqTabProps {
  postId: string | null
  /** Local-mode staging (Create flow, before the post exists). Ignored once
   *  postId is set — FAQs then come straight from the server. */
  value?: BlogPostFaqDraft[]
  onChange?: (faqs: BlogPostFaqDraft[]) => void
}

type FaqRowUnion = BlogPostFaq | BlogPostFaqDraft

export default function PostFaqTab({ postId, value, onChange }: PostFaqTabProps) {
  const queryClient = useQueryClient()
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)
  const [editingFaq, setEditingFaq] = useState<FaqRowUnion | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<FaqRowUnion | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  const isLocal = !postId
  const localFaqs = value ?? []

  const queryKey = ['blog-post-faqs', postId]
  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: () => BlogPostFaqServices.list(postId as string),
    enabled: !isLocal,
  })

  const faqs: FaqRowUnion[] = isLocal ? localFaqs : (data ?? [])

  function openCreate() {
    setEditingFaq(null)
    setIsDrawerOpen(true)
  }

  const openEdit = useCallback((faq: FaqRowUnion) => {
    setEditingFaq(faq)
    setIsDrawerOpen(true)
  }, [])

  async function handleSave(values: CreateFaqFormValues) {
    if (isLocal) {
      if (editingFaq) {
        onChange?.(localFaqs.map((f) => (f.id === editingFaq.id ? { ...f, ...values } : f)))
      } else {
        onChange?.([...localFaqs, { id: crypto.randomUUID(), ...values }])
      }
      return
    }
    if (editingFaq) {
      await BlogPostFaqServices.update(postId as string, editingFaq.id, values)
    } else {
      await BlogPostFaqServices.store(postId as string, values)
    }
    queryClient.invalidateQueries({ queryKey })
  }

  async function handleReorder(items: FaqRowUnion[]) {
    if (isLocal) {
      onChange?.(items as BlogPostFaqDraft[])
      return
    }
    queryClient.setQueryData(queryKey, items)
    await BlogPostFaqServices.reorder(postId as string, items.map((item) => item.id))
    queryClient.invalidateQueries({ queryKey })
  }

  async function handleConfirmDelete() {
    if (!deleteTarget) return
    if (isLocal) {
      onChange?.(localFaqs.filter((f) => f.id !== deleteTarget.id))
      setDeleteTarget(null)
      return
    }
    setIsDeleting(true)
    try {
      await BlogPostFaqServices.delete(postId as string, deleteTarget.id)
      await queryClient.invalidateQueries({ queryKey })
    } catch {
      return
    } finally {
      setIsDeleting(false)
    }
    setDeleteTarget(null)
  }

  const columns = useMemo(() => buildFaqColumns<FaqRowUnion>(openEdit, setDeleteTarget), [openEdit])

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold">Frequently Asked Questions</p>
        <ElementButton size="sm" onClick={openCreate}>
          <Plus size={15} />
          Add FAQ
        </ElementButton>
      </div>

      {isLocal && faqs.length === 0 && (
        <p className="text-sm text-muted-foreground">
          FAQs added here are saved together with the post once you create it.
        </p>
      )}

      <ElementTable<FaqRowUnion>
        columns={columns}
        data={faqs}
        loading={!isLocal && isLoading}
        loadingRows={3}
        emptyContent={<p>No FAQs yet</p>}
        onReorder={handleReorder}
        syncSortWithUrl={false}
      />

      <PostFaqDrawer
        isOpen={isDrawerOpen}
        setIsOpen={setIsDrawerOpen}
        faq={editingFaq}
        onSave={handleSave}
      />

      <ElementModal.Confirm
        isOpen={deleteTarget !== null}
        onClose={(v) => { if (!v) setDeleteTarget(null) }}
        variant="danger"
        title="Delete FAQ"
        description={deleteTarget ? `Are you sure you want to delete "${deleteTarget.question}"? This action cannot be undone.` : undefined}
        confirmText="Delete"
        cancelText="Cancel"
        isLoading={isDeleting}
        onConfirm={handleConfirmDelete}
      />
    </div>
  )
}
