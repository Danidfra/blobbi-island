// NOTE: This file is stable and usually should not be modified.
// It is important that all functionality in this file is preserved, and should only be modified if explicitly requested.
// Phase 3 polish: presentation only (fit-to-frame max-height/scroll + cozy island styling + friendlier copy).
// Authentication logic, hooks, and login methods are unchanged.

import React, { useRef, useState } from 'react';
import { Shield, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button.tsx';
import { Input } from '@/components/ui/input.tsx';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog.tsx';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs.tsx';
import { useLoginActions } from '@/hooks/useLoginActions';

interface LoginDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onLogin: () => void;
  onSignup?: () => void;
}

const LoginDialog: React.FC<LoginDialogProps> = ({ isOpen, onClose, onLogin, onSignup }) => {
  const [isLoading, setIsLoading] = useState(false);
  const [nsec, setNsec] = useState('');
  const [bunkerUri, setBunkerUri] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const login = useLoginActions();

  const handleExtensionLogin = () => {
    setIsLoading(true);
    try {
      if (!('nostr' in window)) {
        throw new Error('Nostr extension not found. Please install a NIP-07 extension.');
      }
      login.extension();
      onLogin();
      onClose();
    } catch (error) {
      console.error('Extension login failed:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyLogin = () => {
    if (!nsec.trim()) return;
    setIsLoading(true);
    
    try {
      login.nsec(nsec);
      onLogin();
      onClose();
    } catch (error) {
      console.error('Nsec login failed:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleBunkerLogin = () => {
    if (!bunkerUri.trim() || !bunkerUri.startsWith('bunker://')) return;
    setIsLoading(true);
    
    try {
      login.bunker(bunkerUri);
      onLogin();
      onClose();
    } catch (error) {
      console.error('Bunker login failed:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      setNsec(content.trim());
    };
    reader.readAsText(file);
  };

  const handleSignupClick = () => {
    onClose();
    if (onSignup) {
      onSignup();
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className='sm:max-w-md max-h-[90dvh] flex flex-col p-0 overflow-hidden rounded-2xl border-4 border-island-wood bg-island-cream'>
        <DialogHeader className='px-6 pt-6 pb-0 relative shrink-0'>
          <DialogTitle className='text-xl font-semibold text-center text-island-ink'>Welcome back to the island</DialogTitle>
          <DialogDescription className='text-center text-island-ink-soft mt-1'>
            Show your passport to come on in
          </DialogDescription>
        </DialogHeader>

        <div className='px-6 py-6 space-y-6 overflow-y-auto'>
          <Tabs defaultValue={'nostr' in window ? 'extension' : 'key'} className='w-full'>
            <TabsList className='grid grid-cols-3 mb-6 bg-island-cream-2/70'>
              <TabsTrigger value='extension'>Extension</TabsTrigger>
              <TabsTrigger value='key'>Nsec</TabsTrigger>
              <TabsTrigger value='bunker'>Bunker</TabsTrigger>
            </TabsList>

            <TabsContent value='extension' className='space-y-4'>
              <div className='text-center p-4 rounded-xl bg-island-cream-2/70 border-2 border-island-wood/20'>
                <Shield className='w-12 h-12 mx-auto mb-3 text-island-wood-dark' />
                <p className='text-sm text-island-ink-soft mb-4'>
                  Sign in with one tap using your browser extension
                </p>
                <Button
                  className='w-full rounded-full py-6'
                  onClick={handleExtensionLogin}
                  disabled={isLoading}
                >
                  {isLoading ? 'Logging in...' : 'Login with Extension'}
                </Button>
              </div>
            </TabsContent>

            <TabsContent value='key' className='space-y-4'>
              <div className='space-y-4'>
                <div className='space-y-2'>
                  <label htmlFor='nsec' className='text-sm font-medium text-island-ink'>
                    Enter your passport key (nsec)
                  </label>
                  <Input
                    type='password'
                    id='nsec'
                    value={nsec}
                    onChange={(e) => setNsec(e.target.value)}
                    className='rounded-lg border-island-wood/30 focus-visible:ring-island-purple'
                    placeholder='nsec1...'
                  />
                </div>

                <div className='text-center'>
                  <p className='text-sm mb-2 text-island-ink-soft'>Or upload a saved key file</p>
                  <input
                    type='file'
                    accept='.txt'
                    className='hidden'
                    ref={fileInputRef}
                    onChange={handleFileUpload}
                  />
                  <Button
                    variant='outline'
                    className='w-full border-island-wood/40 bg-island-cream-2 hover:bg-island-sand'
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Upload className='w-4 h-4 mr-2' />
                    Upload Key File
                  </Button>
                </div>

                <Button
                  className='w-full rounded-full py-6 mt-4'
                  onClick={handleKeyLogin}
                  disabled={isLoading || !nsec.trim()}
                >
                  {isLoading ? 'Verifying...' : 'Login with Nsec'}
                </Button>
              </div>
            </TabsContent>

            <TabsContent value='bunker' className='space-y-4'>
              <div className='space-y-2'>
                <label htmlFor='bunkerUri' className='text-sm font-medium text-island-ink'>
                  Remote signer (Bunker URI)
                </label>
                <Input
                  id='bunkerUri'
                  value={bunkerUri}
                  onChange={(e) => setBunkerUri(e.target.value)}
                  className='rounded-lg border-island-wood/30 focus-visible:ring-island-purple'
                  placeholder='bunker://'
                />
                {bunkerUri && !bunkerUri.startsWith('bunker://') && (
                  <p className='text-red-500 text-xs'>URI must start with bunker://</p>
                )}
              </div>

              <Button
                className='w-full rounded-full py-6'
                onClick={handleBunkerLogin}
                disabled={isLoading || !bunkerUri.trim() || !bunkerUri.startsWith('bunker://')}
              >
                {isLoading ? 'Connecting...' : 'Login with Bunker'}
              </Button>
            </TabsContent>
          </Tabs>

          <div className='text-center text-sm'>
            <p className='text-island-ink-soft'>
              First time on the island?{' '}
              <button
                onClick={handleSignupClick}
                className='text-island-purple hover:underline font-medium'
              >
                Get your passport
              </button>
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default LoginDialog;
