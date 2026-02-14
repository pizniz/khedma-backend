import { supabaseAdmin } from './supabase';
import { AppError } from '../middleware/errorHandler';
import type { Conversation, ConversationWithPreview, Message } from '../types';

class ChatService {
  /**
   * Find an existing conversation between client and provider, or create a new one.
   */
  async getOrCreateConversation(
    clientId: string,
    providerId: string,
    bookingId?: string
  ): Promise<Conversation> {
    // Cannot chat with yourself
    if (clientId === providerId) {
      throw new AppError('You cannot start a conversation with yourself', 400);
    }

    // Check if conversation already exists between these two users
    const { data: existing } = await supabaseAdmin
      .from('conversations')
      .select('*')
      .eq('client_id', clientId)
      .eq('provider_id', providerId)
      .single();

    if (existing) {
      return existing as Conversation;
    }

    // Verify provider exists
    const { data: provider, error: providerError } = await supabaseAdmin
      .from('profiles')
      .select('user_id, user_type')
      .eq('user_id', providerId)
      .eq('user_type', 'provider')
      .single();

    if (providerError || !provider) {
      throw new AppError('Provider not found', 404);
    }

    // If booking_id is provided, verify it belongs to these users
    if (bookingId) {
      const { data: booking, error: bookingError } = await supabaseAdmin
        .from('bookings')
        .select('id')
        .eq('id', bookingId)
        .eq('client_id', clientId)
        .eq('provider_id', providerId)
        .single();

      if (bookingError || !booking) {
        throw new AppError('Booking not found or does not belong to these users', 404);
      }
    }

    // Create conversation
    const { data, error } = await supabaseAdmin
      .from('conversations')
      .insert({
        client_id: clientId,
        provider_id: providerId,
        booking_id: bookingId || null,
      })
      .select()
      .single();

    if (error || !data) {
      // Handle unique constraint violation (race condition)
      if (error?.code === '23505') {
        const { data: retried } = await supabaseAdmin
          .from('conversations')
          .select('*')
          .eq('client_id', clientId)
          .eq('provider_id', providerId)
          .single();

        if (retried) {
          return retried as Conversation;
        }
      }

      console.error('[ChatService] Error creating conversation:', error);
      throw new AppError('Failed to create conversation', 500);
    }

    return data as Conversation;
  }

  /**
   * List all conversations for a user, with last message preview and unread count.
   */
  async listConversations(userId: string): Promise<ConversationWithPreview[]> {
    // Get all conversations where user is client or provider
    const { data: conversations, error } = await supabaseAdmin
      .from('conversations')
      .select('*')
      .or(`client_id.eq.${userId},provider_id.eq.${userId}`)
      .order('updated_at', { ascending: false });

    if (error) {
      console.error('[ChatService] Error listing conversations:', error);
      throw new AppError('Failed to fetch conversations', 500);
    }

    if (!conversations || conversations.length === 0) {
      return [];
    }

    // For each conversation, get last message + unread count + other user's profile
    const results: ConversationWithPreview[] = await Promise.all(
      conversations.map(async (conv: any) => {
        // Get last message
        const { data: lastMsg } = await supabaseAdmin
          .from('messages')
          .select('content, created_at')
          .eq('conversation_id', conv.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .single();

        // Get unread count (messages not sent by this user, not yet read)
        const { count: unreadCount } = await supabaseAdmin
          .from('messages')
          .select('id', { count: 'exact', head: true })
          .eq('conversation_id', conv.id)
          .neq('sender_id', userId)
          .is('read_at', null);

        // Get the other user's profile
        const otherUserId = conv.client_id === userId ? conv.provider_id : conv.client_id;
        const { data: otherProfile } = await supabaseAdmin
          .from('profiles')
          .select('user_id, full_name, avatar_url')
          .eq('user_id', otherUserId)
          .single();

        return {
          ...conv,
          last_message: lastMsg?.content || null,
          last_message_at: lastMsg?.created_at || null,
          unread_count: unreadCount || 0,
          other_user: otherProfile
            ? {
                user_id: otherProfile.user_id,
                full_name: otherProfile.full_name,
                avatar_url: otherProfile.avatar_url,
              }
            : undefined,
        } as ConversationWithPreview;
      })
    );

    return results;
  }

  /**
   * Get paginated messages for a conversation. Verifies user is a participant.
   */
  async getMessages(
    conversationId: string,
    userId: string,
    page: number = 1,
    limit: number = 50
  ): Promise<{ messages: Message[]; total: number }> {
    // Verify user is a participant
    await this.verifyParticipant(conversationId, userId);

    const offset = (page - 1) * limit;

    const { data, error, count } = await supabaseAdmin
      .from('messages')
      .select('*', { count: 'exact' })
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      console.error('[ChatService] Error fetching messages:', error);
      throw new AppError('Failed to fetch messages', 500);
    }

    return {
      messages: (data || []) as Message[],
      total: count || 0,
    };
  }

  /**
   * Send a message in a conversation. Verifies sender is a participant.
   */
  async sendMessage(
    conversationId: string,
    senderId: string,
    content: string
  ): Promise<Message> {
    // Verify sender is a participant
    await this.verifyParticipant(conversationId, senderId);

    const { data, error } = await supabaseAdmin
      .from('messages')
      .insert({
        conversation_id: conversationId,
        sender_id: senderId,
        content,
      })
      .select()
      .single();

    if (error || !data) {
      console.error('[ChatService] Error sending message:', error);
      throw new AppError('Failed to send message', 500);
    }

    return data as Message;
  }

  /**
   * Mark all messages in a conversation as read for the given user.
   * Only marks messages NOT sent by this user (i.e., messages from the other party).
   */
  async markAsRead(conversationId: string, userId: string): Promise<number> {
    // Verify user is a participant
    await this.verifyParticipant(conversationId, userId);

    const { data, error } = await supabaseAdmin
      .from('messages')
      .update({ read_at: new Date().toISOString() })
      .eq('conversation_id', conversationId)
      .neq('sender_id', userId)
      .is('read_at', null)
      .select('id');

    if (error) {
      console.error('[ChatService] Error marking messages as read:', error);
      throw new AppError('Failed to mark messages as read', 500);
    }

    return data?.length || 0;
  }

  /**
   * Verify that a user is a participant in a conversation.
   */
  private async verifyParticipant(conversationId: string, userId: string): Promise<void> {
    const { data: conversation, error } = await supabaseAdmin
      .from('conversations')
      .select('id')
      .eq('id', conversationId)
      .or(`client_id.eq.${userId},provider_id.eq.${userId}`)
      .single();

    if (error || !conversation) {
      throw new AppError('Conversation not found or access denied', 404);
    }
  }
}

export const chatService = new ChatService();
