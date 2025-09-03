import { useMutation } from "@tanstack/react-query";
import { dataUrlToBlob } from "@/lib/dataUrlToBlob";

interface ImgBBResponse {
  success: boolean;
  data: {
    id: string;
    url: string;
    display_url: string;
    title: string;
    filename: string;
    size: number;
    time: string;
    expiration: string | null;
  };
  error?: {
    message: string;
    code: number;
    context?: string;
  };
}

export function useImgBBUpload() {
  return useMutation({
    mutationFn: async (input: File | string): Promise<string> => {
      let file: File;

      // Convert dataURL to File if needed
      if (typeof input === 'string') {
        if (input.startsWith('data:')) {
          const blob = dataUrlToBlob(input);
          file = new File([blob], 'image.png', { type: blob.type });
        } else {
          throw new Error('Invalid dataURL format');
        }
      } else {
        file = input;
      }

      // Compress/convert to WEBP if the image is large and not already WEBP
      let processedFile = file;

      if (file.size > 2 * 1024 * 1024 && !file.type.includes('webp')) { // If larger than 2MB and not WEBP
        try {
          // Convert to WEBP with quality 0.8
          const bitmap = await createImageBitmap(file);
          const canvas = document.createElement('canvas');
          canvas.width = bitmap.width;
          canvas.height = bitmap.height;

          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(bitmap, 0, 0);

            // Convert to WEBP blob
            const webpBlob = await new Promise<Blob>((resolve, reject) => {
              canvas.toBlob((blob) => {
                if (blob) {
                  resolve(blob);
                } else {
                  reject(new Error('Failed to convert to WEBP'));
                }
              }, 'image/webp', 0.8);
            });

            // Create new File object
            processedFile = new File([webpBlob], file.name.replace(/\.[^/.]+$/, '.webp'), {
              type: 'image/webp',
              lastModified: Date.now()
            });
          }
        } catch (error) {
          console.warn('Failed to compress image to WEBP, using original:', error);
          // Fall back to original file
        }
      }

      // Get API key from environment variables
      const imgbbApiKey = import.meta.env.VITE_IMGBB_API_KEY;

      if (!imgbbApiKey) {
        throw new Error('ImgBB API key not configured. Please set VITE_IMGBB_API_KEY environment variable.');
      }

      // Upload to ImgBB API
      const formData = new FormData();
      formData.append('image', processedFile);

      // Add optional name and expiration
      formData.append('name', 'blobbi-photo');
      formData.append('expiration', '600'); // 10 minutes in seconds

      const response = await fetch(`https://api.imgbb.com/1/upload?key=${imgbbApiKey}`, {
        method: 'POST',
        body: formData,
        // Don't set Content-Type header, let browser handle it for multipart/form-data
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('ImgBB API error:', response.status, errorText);
        throw new Error(`Upload failed: ${response.status} ${errorText}`);
      }

      const data: ImgBBResponse = await response.json();

      if (!data.success || !data.data) {
        throw new Error('Upload failed: Invalid response from ImgBB API');
      }

      // Return the public URL (prefer display_url, fallback to url)
      return data.data.display_url || data.data.url;
    },
  });
}