-- Create storage bucket for voice messages
INSERT INTO storage.buckets (id, name, public)
VALUES ('voice-messages', 'voice-messages', true);

-- Allow authenticated users to upload voice messages
CREATE POLICY "Authenticated users can upload voice messages"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'voice-messages');

-- Allow anyone to read voice messages (they're referenced by conversation participants)
CREATE POLICY "Anyone can read voice messages"
ON storage.objects FOR SELECT
USING (bucket_id = 'voice-messages');