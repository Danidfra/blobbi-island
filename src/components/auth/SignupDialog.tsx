// NOTE: This file is stable and usually should not be modified.
// It is important that all functionality in this file is preserved, and should only be modified if explicitly requested.
// Phase 3 polish: presentation only (fit-to-frame max-height/scroll + cozy island styling + friendlier copy).
// Key generation / signup logic is unchanged.

import React, { useState } from 'react';
import { Download, Key } from 'lucide-react';
import { Button } from '@/components/ui/button.tsx';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog.tsx';
import { toast } from '@/hooks/useToast.ts';
import { useLoginActions } from '@/hooks/useLoginActions';
import { generateSecretKey, nip19 } from 'nostr-tools';

interface SignupDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

const SignupDialog: React.FC<SignupDialogProps> = ({ isOpen, onClose }) => {
  const [step, setStep] = useState<'generate' | 'download' | 'done'>('generate');
  const [isLoading, setIsLoading] = useState(false);
  const [nsec, setNsec] = useState('');
  const login = useLoginActions();

  // Generate a proper nsec key using nostr-tools
  const generateKey = () => {
    setIsLoading(true);
    
    try {
      // Generate a new secret key
      const sk = generateSecretKey();
      
      // Convert to nsec format
      setNsec(nip19.nsecEncode(sk));
      setStep('download');
    } catch (error) {
      console.error('Failed to generate key:', error);
      toast({
        title: 'Error',
        description: 'Failed to generate key. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const downloadKey = () => {
    // Create a blob with the key text
    const blob = new Blob([nsec], { type: 'text/plain' });
    const url = globalThis.URL.createObjectURL(blob);

    // Create a temporary link element and trigger download
    const a = document.createElement('a');
    a.href = url;
    a.download = 'nsec.txt';
    document.body.appendChild(a);
    a.click();

    // Clean up
    globalThis.URL.revokeObjectURL(url);
    document.body.removeChild(a);

    toast({
      title: 'Key downloaded',
      description: 'Your key has been downloaded. Keep it safe!',
    });
  };

  const finishSignup = () => {
    login.nsec(nsec);

    setStep('done');
    onClose();

    toast({
      title: 'Account created',
      description: 'You are now logged in.',
    });
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className='sm:max-w-md max-h-[90dvh] flex flex-col p-0 overflow-hidden rounded-2xl border-4 border-island-wood bg-island-cream'>
        <DialogHeader className='px-6 pt-6 pb-0 relative shrink-0'>
          <DialogTitle className='text-xl font-semibold text-center text-island-ink'>
            {step === 'generate' && 'Create your island passport'}
            {step === 'download' && 'Keep your passport safe'}
            {step === 'done' && 'Welcome to the island'}
          </DialogTitle>
          <DialogDescription className='text-center text-island-ink-soft mt-1'>
            {step === 'generate' && "We'll make a passport that keeps your Blobbi safe"}
            {step === 'download' && "You'll need this to come back later"}
            {step === 'done' && 'Getting things ready...'}
          </DialogDescription>
        </DialogHeader>

        <div className='px-6 py-6 space-y-6 overflow-y-auto'>
          {step === 'generate' && (
            <div className='text-center space-y-6'>
              <div className='p-4 rounded-xl bg-island-cream-2/70 border-2 border-island-wood/20 flex items-center justify-center'>
                <Key className='w-16 h-16 text-island-wood-dark' />
              </div>
              <p className='text-sm text-island-ink-soft'>
                We'll create a secure passport just for you. You'll use it to return to the island later.
              </p>
              <Button
                className='w-full rounded-full py-6'
                onClick={generateKey}
                disabled={isLoading}
              >
                {isLoading ? 'Creating passport...' : 'Create my passport'}
              </Button>
            </div>
          )}

          {step === 'download' && (
            <div className='space-y-6'>
              <div className='p-4 rounded-xl border-2 border-island-wood/20 bg-island-cream-2/70 overflow-auto'>
                <code className='text-xs break-all text-island-ink'>{nsec}</code>
              </div>

              <div className='text-sm text-island-ink-soft space-y-2'>
                <p className='font-medium text-island-ink'>Keep it cozy and safe:</p>
                <ul className='list-disc pl-5 space-y-1'>
                  <li>This passport is the only way back to your Blobbi</li>
                  <li>Store it somewhere safe</li>
                  <li>Never share it with anyone</li>
                </ul>
              </div>

              <div className='flex flex-col space-y-3'>
                <Button
                  variant='outline'
                  className='w-full border-island-wood/40 bg-island-cream-2 hover:bg-island-sand'
                  onClick={downloadKey}
                >
                  <Download className='w-4 h-4 mr-2' />
                  Save my passport
                </Button>

                <Button
                  className='w-full rounded-full py-6'
                  onClick={finishSignup}
                >
                  I've saved it, enter the island
                </Button>
              </div>
            </div>
          )}

          {step === 'done' && (
            <div className='flex justify-center items-center py-8'>
              <div className='animate-spin rounded-full h-12 w-12 border-b-2 border-island-wood-dark'></div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default SignupDialog;
