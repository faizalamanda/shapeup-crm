export type PipelineVisibility = 'everyone' | 'members_only';
export type PipelineMemberRole = 'owner' | 'editor' | 'viewer';
export type PipelineType = 'sales' | 'productivity' | 'production' | 'hiring' | 'custom';
export type CardPriority = 'low' | 'medium' | 'high' | 'urgent';
export type CardStatus = 'active' | 'won' | 'lost' | 'archived';

export interface CardLabel {
    id: string;
    name: string;
    color: string;
}

export interface PipelineMember {
    id: string;
    pipeline_id: string;
    user_id: string;
    role: PipelineMemberRole;
    created_at: string;
    // Expanded profile data
    profile?: {
        id: string;
        full_name?: string | null;
        email?: string | null;
    };
}

export interface PipelineStage {
    id: string;
    pipeline_id: string;
    name: string;
    description?: string | null;
    color: string;
    display_order: number;
    wip_limit?: number | null;
    is_won_stage: boolean;
    is_lost_stage: boolean;
    created_at?: string;
    updated_at?: string;
    // Transient array for UI board mapping
    cards?: PipelineCard[];
}

export interface PipelineCard {
    id: string;
    pipeline_id: string;
    stage_id: string;
    title: string;
    description?: string | null;
    value: number;
    priority: CardPriority;
    assignee_id?: string | null;
    due_date?: string | null;
    labels: CardLabel[];
    custom_fields: Record<string, any>;
    display_order: number;
    status: CardStatus;
    created_by?: string | null;
    created_at: string;
    updated_at: string;
    // Expanded relationships
    assignee?: {
        id: string;
        full_name?: string | null;
        email?: string | null;
    } | null;
    creator?: {
        id: string;
        full_name?: string | null;
    } | null;
    activities?: PipelineActivity[];
}

export interface PipelineActivity {
    id: string;
    card_id: string;
    user_id?: string | null;
    activity_type: 'stage_change' | 'comment' | 'value_change' | 'field_update' | 'created' | 'status_change';
    details: Record<string, any>;
    created_at: string;
    user?: {
        id: string;
        full_name?: string | null;
    } | null;
}

export interface Pipeline {
    id: string;
    business_id: string;
    name: string;
    description?: string | null;
    icon: string;
    type: PipelineType;
    currency: string;
    visibility: PipelineVisibility;
    created_by?: string | null;
    created_at: string;
    updated_at: string;
    stages?: PipelineStage[];
    members?: PipelineMember[];
    cards_count?: number;
    total_value?: number;
}

// Input DTOs
export interface CreatePipelineInput {
    business_id: string;
    name: string;
    description?: string;
    icon?: string;
    type?: PipelineType;
    currency?: string;
    visibility?: PipelineVisibility;
    created_by?: string;
    stages?: {
        name: string;
        color?: string;
        wip_limit?: number | null;
        is_won_stage?: boolean;
        is_lost_stage?: boolean;
    }[];
    member_user_ids?: string[];
}

export interface UpdatePipelineInput {
    name?: string;
    description?: string | null;
    icon?: string;
    type?: PipelineType;
    currency?: string;
    visibility?: PipelineVisibility;
}

export interface CreateStageInput {
    pipeline_id: string;
    name: string;
    description?: string | null;
    color?: string;
    display_order?: number;
    wip_limit?: number | null;
    is_won_stage?: boolean;
    is_lost_stage?: boolean;
}

export interface UpdateStageInput {
    name?: string;
    description?: string | null;
    color?: string;
    display_order?: number;
    wip_limit?: number | null;
    is_won_stage?: boolean;
    is_lost_stage?: boolean;
}

export interface CreateCardInput {
    pipeline_id: string;
    stage_id: string;
    title: string;
    description?: string | null;
    value?: number;
    priority?: CardPriority;
    assignee_id?: string | null;
    due_date?: string | null;
    labels?: CardLabel[];
    custom_fields?: Record<string, any>;
    created_by?: string;
}

export interface UpdateCardInput {
    stage_id?: string;
    title?: string;
    description?: string | null;
    value?: number;
    priority?: CardPriority;
    assignee_id?: string | null;
    due_date?: string | null;
    labels?: CardLabel[];
    custom_fields?: Record<string, any>;
    status?: CardStatus;
}

export interface MoveCardInput {
    card_id: string;
    target_stage_id: string;
    new_display_order: number;
    user_id?: string;
}

// UI State & Filter interfaces
export interface KanbanFilterState {
    search: string;
    assigneeId: string | 'all' | 'unassigned';
    priority: CardPriority | 'all';
    status: CardStatus | 'all';
    labelId: string | 'all';
}

export interface PipelineStatsSummary {
    totalCards: number;
    totalValue: number;
    wonCards: number;
    wonValue: number;
    lostCards: number;
    conversionRate: number;
    stageStats: {
        stageId: string;
        stageName: string;
        color: string;
        count: number;
        value: number;
    }[];
}
