import { SupabaseClient } from '@supabase/supabase-js';
import {
  Pipeline,
  PipelineStage,
  PipelineCard,
  PipelineActivity,
  PipelineMember,
  CreatePipelineInput,
  UpdatePipelineInput,
  CreateStageInput,
  UpdateStageInput,
  CreateCardInput,
  UpdateCardInput,
  MoveCardInput,
} from '../types';
import { getDefaultStagePresets } from './kanbanUtils';

/**
 * Fetch all pipelines accessible to a user in a business
 */
export async function fetchPipelines(
  supabase: SupabaseClient,
  businessId: string,
  userId?: string
): Promise<{ data: Pipeline[] | null; error: any }> {
  try {
    let query = supabase
      .from('pipelines')
      .select(`
        *,
        stages:pipeline_stages(id, name, color, display_order),
        members:pipeline_members(id, user_id, role)
      `)
      .eq('business_id', businessId)
      .order('created_at', { ascending: true });

    const { data, error } = await query;
    if (error) return { data: null, error };

    // Filter visibility if members_only and userId is specified
    let filteredData = data as Pipeline[];
    if (userId && filteredData) {
      filteredData = filteredData.filter((p) => {
        if (p.visibility === 'everyone') return true;
        if (p.created_by === userId) return true;
        const isMember = p.members && p.members.some((m) => m.user_id === userId);
        return isMember;
      });
    }

    return { data: filteredData, error: null };
  } catch (err) {
    return { data: null, error: err };
  }
}

/**
 * Fetch a single pipeline by ID with full relations (stages, members)
 */
export async function fetchPipelineById(
  supabase: SupabaseClient,
  pipelineId: string
): Promise<{ data: Pipeline | null; error: any }> {
  try {
    const { data, error } = await supabase
      .from('pipelines')
      .select(`
        *,
        stages:pipeline_stages(*),
        members:pipeline_members(
          id, pipeline_id, user_id, role, created_at,
          profile:profiles(id, full_name, email)
        )
      `)
      .eq('id', pipelineId)
      .single();

    if (error) return { data: null, error };

    // Sort stages by display_order
    if (data && data.stages) {
      data.stages.sort((a: PipelineStage, b: PipelineStage) => a.display_order - b.display_order);
    }

    return { data: data as Pipeline, error: null };
  } catch (err) {
    return { data: null, error: err };
  }
}

/**
 * Create a new pipeline with optional initial stages & members
 */
export async function createPipeline(
  supabase: SupabaseClient,
  input: CreatePipelineInput
): Promise<{ data: Pipeline | null; error: any }> {
  try {
    const { data: pipeline, error: pErr } = await supabase
      .from('pipelines')
      .insert({
        business_id: input.business_id,
        name: input.name,
        description: input.description || null,
        icon: input.icon || 'kanban',
        type: input.type || 'sales',
        currency: input.currency || 'IDR',
        visibility: input.visibility || 'everyone',
        created_by: input.created_by || null,
      })
      .select()
      .single();

    if (pErr || !pipeline) return { data: null, error: pErr };

    // Insert default stages
    const defaultStages = input.stages || getDefaultStagePresets(input.type || 'sales');
    const stageRecords = defaultStages.map((st, idx) => ({
      pipeline_id: pipeline.id,
      name: st.name,
      color: st.color || '#3B82F6',
      display_order: idx,
      wip_limit: st.wip_limit || null,
      is_won_stage: st.is_won_stage || false,
      is_lost_stage: st.is_lost_stage || false,
    }));

    const { data: stages, error: stErr } = await supabase
      .from('pipeline_stages')
      .insert(stageRecords)
      .select();

    if (stErr) console.error('Error creating initial stages:', stErr);

    // Insert owner/members if specified
    if (input.created_by) {
      await supabase.from('pipeline_members').insert({
        pipeline_id: pipeline.id,
        user_id: input.created_by,
        role: 'owner',
      });
    }

    if (input.member_user_ids && input.member_user_ids.length > 0) {
      const memberRecords = input.member_user_ids
        .filter((uid) => uid !== input.created_by)
        .map((uid) => ({
          pipeline_id: pipeline.id,
          user_id: uid,
          role: 'editor' as const,
        }));

      if (memberRecords.length > 0) {
        await supabase.from('pipeline_members').insert(memberRecords);
      }
    }

    return {
      data: {
        ...pipeline,
        stages: stages || [],
      } as Pipeline,
      error: null,
    };
  } catch (err) {
    return { data: null, error: err };
  }
}

/**
 * Update pipeline metadata
 */
export async function updatePipeline(
  supabase: SupabaseClient,
  pipelineId: string,
  input: UpdatePipelineInput
): Promise<{ data: Pipeline | null; error: any }> {
  try {
    const { data, error } = await supabase
      .from('pipelines')
      .update({
        ...input,
        updated_at: new Date().toISOString(),
      })
      .eq('id', pipelineId)
      .select()
      .single();

    return { data: data as Pipeline, error };
  } catch (err) {
    return { data: null, error: err };
  }
}

/**
 * Delete pipeline (cascades to stages, cards, activities, members)
 */
export async function deletePipeline(
  supabase: SupabaseClient,
  pipelineId: string
): Promise<{ error: any }> {
  try {
    const { error } = await supabase.from('pipelines').delete().eq('id', pipelineId);
    return { error };
  } catch (err) {
    return { error: err };
  }
}

/**
 * Fetch stages for a pipeline
 */
export async function fetchPipelineStages(
  supabase: SupabaseClient,
  pipelineId: string
): Promise<{ data: PipelineStage[] | null; error: any }> {
  try {
    const { data, error } = await supabase
      .from('pipeline_stages')
      .select('*')
      .eq('pipeline_id', pipelineId)
      .order('display_order', { ascending: true });

    return { data: data as PipelineStage[], error };
  } catch (err) {
    return { data: null, error: err };
  }
}

/**
 * Create a new stage in a pipeline
 */
export async function createStage(
  supabase: SupabaseClient,
  input: CreateStageInput
): Promise<{ data: PipelineStage | null; error: any }> {
  try {
    // Determine next display order if not provided
    let order = input.display_order;
    if (order === undefined) {
      const { data: existingStages } = await supabase
        .from('pipeline_stages')
        .select('display_order')
        .eq('pipeline_id', input.pipeline_id)
        .order('display_order', { ascending: false })
        .limit(1);

      order = existingStages && existingStages.length > 0 ? existingStages[0].display_order + 1 : 0;
    }

    const { data, error } = await supabase
      .from('pipeline_stages')
      .insert({
        pipeline_id: input.pipeline_id,
        name: input.name,
        description: input.description || null,
        color: input.color || '#3B82F6',
        display_order: order,
        wip_limit: input.wip_limit || null,
        is_won_stage: input.is_won_stage || false,
        is_lost_stage: input.is_lost_stage || false,
      })
      .select()
      .single();

    return { data: data as PipelineStage, error };
  } catch (err) {
    return { data: null, error: err };
  }
}

/**
 * Update an existing stage
 */
export async function updateStage(
  supabase: SupabaseClient,
  stageId: string,
  input: UpdateStageInput
): Promise<{ data: PipelineStage | null; error: any }> {
  try {
    const { data, error } = await supabase
      .from('pipeline_stages')
      .update({
        ...input,
        updated_at: new Date().toISOString(),
      })
      .eq('id', stageId)
      .select()
      .single();

    return { data: data as PipelineStage, error };
  } catch (err) {
    return { data: null, error: err };
  }
}

/**
 * Reorder stages array by updating display_order for each stage
 */
export async function reorderStages(
  supabase: SupabaseClient,
  pipelineId: string,
  orderedStageIds: string[]
): Promise<{ error: any }> {
  try {
    const updates = orderedStageIds.map((id, index) =>
      supabase
        .from('pipeline_stages')
        .update({ display_order: index, updated_at: new Date().toISOString() })
        .eq('id', id)
        .eq('pipeline_id', pipelineId)
    );

    await Promise.all(updates);
    return { error: null };
  } catch (err) {
    return { error: err };
  }
}

/**
 * Delete a stage
 */
export async function deleteStage(
  supabase: SupabaseClient,
  stageId: string
): Promise<{ error: any }> {
  try {
    const { error } = await supabase.from('pipeline_stages').delete().eq('id', stageId);
    return { error };
  } catch (err) {
    return { error: err };
  }
}

/**
 * Fetch all cards in a pipeline with assignee relation
 */
export async function fetchPipelineCards(
  supabase: SupabaseClient,
  pipelineId: string
): Promise<{ data: PipelineCard[] | null; error: any }> {
  try {
    const { data, error } = await supabase
      .from('pipeline_cards')
      .select(`
        *,
        assignee:profiles!pipeline_cards_assignee_id_fkey(id, full_name, email),
        creator:profiles!pipeline_cards_created_by_fkey(id, full_name)
      `)
      .eq('pipeline_id', pipelineId)
      .order('display_order', { ascending: true });

    return { data: data as PipelineCard[], error };
  } catch (err) {
    return { data: null, error: err };
  }
}

/**
 * Create a new card in a stage
 */
export async function createCard(
  supabase: SupabaseClient,
  input: CreateCardInput
): Promise<{ data: PipelineCard | null; error: any }> {
  try {
    // Find next display order in target stage
    const { data: existingCards } = await supabase
      .from('pipeline_cards')
      .select('display_order')
      .eq('stage_id', input.stage_id)
      .order('display_order', { ascending: false })
      .limit(1);

    const nextOrder = existingCards && existingCards.length > 0 ? existingCards[0].display_order + 1 : 0;

    const { data: card, error } = await supabase
      .from('pipeline_cards')
      .insert({
        pipeline_id: input.pipeline_id,
        stage_id: input.stage_id,
        title: input.title,
        description: input.description || null,
        value: input.value || 0,
        priority: input.priority || 'medium',
        assignee_id: input.assignee_id || null,
        due_date: input.due_date || null,
        labels: input.labels || [],
        custom_fields: input.custom_fields || {},
        display_order: nextOrder,
        status: 'active',
        created_by: input.created_by || null,
      })
      .select(`
        *,
        assignee:profiles!pipeline_cards_assignee_id_fkey(id, full_name, email),
        creator:profiles!pipeline_cards_created_by_fkey(id, full_name)
      `)
      .single();

    if (card) {
      // Log creation activity
      await addCardActivity(supabase, card.id, input.created_by, 'created', {
        title: card.title,
      });
    }

    return { data: card as PipelineCard, error };
  } catch (err) {
    return { data: null, error: err };
  }
}

/**
 * Update card properties
 */
export async function updateCard(
  supabase: SupabaseClient,
  cardId: string,
  input: UpdateCardInput,
  userId?: string
): Promise<{ data: PipelineCard | null; error: any }> {
  try {
    const { data, error } = await supabase
      .from('pipeline_cards')
      .update({
        ...input,
        updated_at: new Date().toISOString(),
      })
      .eq('id', cardId)
      .select(`
        *,
        assignee:profiles!pipeline_cards_assignee_id_fkey(id, full_name, email),
        creator:profiles!pipeline_cards_created_by_fkey(id, full_name)
      `)
      .single();

    if (data && userId) {
      if (input.status) {
        await addCardActivity(supabase, cardId, userId, 'status_change', { status: input.status });
      }
      if (input.value !== undefined) {
        await addCardActivity(supabase, cardId, userId, 'value_change', { new_value: input.value });
      }
    }

    return { data: data as PipelineCard, error };
  } catch (err) {
    return { data: null, error: err };
  }
}

/**
 * Move card to a new stage / position & log activity
 */
export async function moveCard(
  supabase: SupabaseClient,
  input: MoveCardInput
): Promise<{ data: PipelineCard | null; error: any }> {
  try {
    // 1. Fetch current card
    const { data: currentCard } = await supabase
      .from('pipeline_cards')
      .select('id, stage_id, title')
      .eq('id', input.card_id)
      .single();

    const previousStageId = currentCard?.stage_id;

    // 2. Update stage and order
    const { data: updatedCard, error } = await supabase
      .from('pipeline_cards')
      .update({
        stage_id: input.target_stage_id,
        display_order: input.new_display_order,
        updated_at: new Date().toISOString(),
      })
      .eq('id', input.card_id)
      .select(`
        *,
        assignee:profiles!pipeline_cards_assignee_id_fkey(id, full_name, email)
      `)
      .single();

    if (error || !updatedCard) return { data: null, error };

    // 3. Log activity if stage changed
    if (previousStageId && previousStageId !== input.target_stage_id) {
      // Get stage names for clean activity log
      const { data: stages } = await supabase
        .from('pipeline_stages')
        .select('id, name')
        .in('id', [previousStageId, input.target_stage_id]);

      const prevStageObj = stages?.find((s) => s.id === previousStageId);
      const newStageObj = stages?.find((s) => s.id === input.target_stage_id);

      await addCardActivity(supabase, input.card_id, input.user_id, 'stage_change', {
        from_stage_id: previousStageId,
        from_stage_name: prevStageObj?.name || 'Stage Lain',
        to_stage_id: input.target_stage_id,
        to_stage_name: newStageObj?.name || 'Stage Baru',
      });
    }

    return { data: updatedCard as PipelineCard, error: null };
  } catch (err) {
    return { data: null, error: err };
  }
}

/**
 * Delete a card
 */
export async function deleteCard(
  supabase: SupabaseClient,
  cardId: string
): Promise<{ error: any }> {
  try {
    const { error } = await supabase.from('pipeline_cards').delete().eq('id', cardId);
    return { error };
  } catch (err) {
    return { error: err };
  }
}

/**
 * Fetch activities/history for a card
 */
export async function fetchCardActivities(
  supabase: SupabaseClient,
  cardId: string
): Promise<{ data: PipelineActivity[] | null; error: any }> {
  try {
    const { data, error } = await supabase
      .from('pipeline_activities')
      .select(`
        *,
        user:profiles(id, full_name)
      `)
      .eq('card_id', cardId)
      .order('created_at', { ascending: false });

    return { data: data as PipelineActivity[], error };
  } catch (err) {
    return { data: null, error: err };
  }
}

/**
 * Add an activity log entry for a card
 */
export async function addCardActivity(
  supabase: SupabaseClient,
  cardId: string,
  userId: string | undefined | null,
  activityType: PipelineActivity['activity_type'],
  details: Record<string, any>
): Promise<{ data: PipelineActivity | null; error: any }> {
  try {
    const { data, error } = await supabase
      .from('pipeline_activities')
      .insert({
        card_id: cardId,
        user_id: userId || null,
        activity_type: activityType,
        details: details || {},
      })
      .select(`
        *,
        user:profiles(id, full_name)
      `)
      .single();

    return { data: data as PipelineActivity, error };
  } catch (err) {
    return { data: null, error: err };
  }
}

/**
 * Fetch staff members for a business (for assignee dropdown & member selector)
 */
export async function fetchBusinessStaffProfiles(
  supabase: SupabaseClient,
  businessId: string
): Promise<{ data: { id: string; full_name?: string | null; email?: string | null }[] | null; error: any }> {
  try {
    const { data, error } = await supabase
      .from('business_staff')
      .select(`
        profile_id,
        profile:profiles!business_staff_profile_id_fkey(id, full_name, email)
      `)
      .eq('business_id', businessId);

    if (error || !data) return { data: null, error };

    const profiles = data
      .map((item: any) => item.profile)
      .filter((p: any) => p && p.id);

    return { data: profiles, error: null };
  } catch (err) {
    return { data: null, error: err };
  }
}

/**
 * Fetch pipeline members
 */
export async function fetchPipelineMembers(
  supabase: SupabaseClient,
  pipelineId: string
): Promise<{ data: PipelineMember[] | null; error: any }> {
  try {
    const { data, error } = await supabase
      .from('pipeline_members')
      .select(`
        *,
        profile:profiles(id, full_name, email)
      `)
      .eq('pipeline_id', pipelineId);

    return { data: data as PipelineMember[], error };
  } catch (err) {
    return { data: null, error: err };
  }
}

/**
 * Add member to pipeline
 */
export async function addPipelineMember(
  supabase: SupabaseClient,
  pipelineId: string,
  userId: string,
  role: PipelineMember['role'] = 'editor'
): Promise<{ data: PipelineMember | null; error: any }> {
  try {
    const { data, error } = await supabase
      .from('pipeline_members')
      .upsert({
        pipeline_id: pipelineId,
        user_id: userId,
        role: role,
      })
      .select(`
        *,
        profile:profiles(id, full_name, email)
      `)
      .single();

    return { data: data as PipelineMember, error };
  } catch (err) {
    return { data: null, error: err };
  }
}

/**
 * Remove member from pipeline
 */
export async function removePipelineMember(
  supabase: SupabaseClient,
  pipelineId: string,
  userId: string
): Promise<{ error: any }> {
  try {
    const { error } = await supabase
      .from('pipeline_members')
      .delete()
      .eq('pipeline_id', pipelineId)
      .eq('user_id', userId);

    return { error };
  } catch (err) {
    return { error: err };
  }
}
