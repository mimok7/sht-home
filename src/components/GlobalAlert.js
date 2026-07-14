'use client';

import { useState, useEffect } from 'react';

export default function GlobalAlert() {
  const [isOpen, setIsOpen] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    // Override default window.alert
    const originalAlert = window.alert;
    
    window.alert = (msg) => {
      setMessage(msg);
      setIsOpen(true);
    };

    return () => {
      // Restore original alert on unmount
      window.alert = originalAlert;
    };
  }, []);

  if (!isOpen) return null;

  return (
    <div style={{
      position: 'fixed',
      top: 0, left: 0, right: 0, bottom: 0,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'rgba(15, 23, 42, 0.4)',
      backdropFilter: 'blur(4px)',
      zIndex: 99999,
      padding: '1rem',
      animation: 'globalAlertFadeIn 0.2s ease-out'
    }}>
      <div style={{
        backgroundColor: '#ffffff',
        borderRadius: '16px',
        boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
        width: '100%',
        maxWidth: '400px',
        overflow: 'hidden',
        animation: 'globalAlertSlideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1)'
      }}>
        {/* Header */}
        <div style={{
          backgroundColor: '#f8fafc',
          padding: '1.25rem 1.5rem',
          borderBottom: '1px solid #e2e8f0',
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem'
        }}>
          <span style={{ fontSize: '1.25rem' }}>✈️</span>
          <h3 style={{ 
            margin: 0, 
            fontSize: '1.1rem', 
            color: '#1e293b',
            fontWeight: '600'
          }}>
            즐거운 여행되세요
          </h3>
        </div>
        
        {/* Body */}
        <div style={{
          padding: '1.5rem',
          color: '#475569',
          fontSize: '1rem',
          lineHeight: '1.6',
          whiteSpace: 'pre-wrap'
        }}>
          {message}
        </div>
        
        {/* Footer */}
        <div style={{
          padding: '1rem 1.5rem',
          borderTop: '1px solid #e2e8f0',
          display: 'flex',
          justifyContent: 'flex-end',
          backgroundColor: '#f8fafc'
        }}>
          <button 
            onClick={() => setIsOpen(false)}
            style={{
              backgroundColor: '#0ea5e9',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              padding: '0.6rem 1.5rem',
              fontSize: '0.95rem',
              fontWeight: '600',
              cursor: 'pointer',
              transition: 'background-color 0.2s'
            }}
            onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#0284c7'}
            onMouseOut={(e) => e.currentTarget.style.backgroundColor = '#0ea5e9'}
          >
            확인
          </button>
        </div>
      </div>

    </div>
  );
}
