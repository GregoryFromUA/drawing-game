import { useState } from 'react';
import DesignShowcase from './DesignShowcase';

function ShowcaseButton() {
    const [showShowcase, setShowShowcase] = useState(false);

    if (showShowcase) {
        return (
            <div style={{ position: 'relative' }}>
                <button
                    onClick={() => setShowShowcase(false)}
                    style={{
                        position: 'fixed',
                        top: '20px',
                        right: '20px',
                        zIndex: 10000,
                        padding: '12px 24px',
                        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                        color: 'white',
                        border: 'none',
                        borderRadius: '12px',
                        fontSize: '1em',
                        fontWeight: '700',
                        cursor: 'pointer',
                        boxShadow: '0 4px 15px rgba(0, 0, 0, 0.3)',
                        transition: 'all 0.3s ease'
                    }}
                    onMouseEnter={(e) => {
                        e.target.style.transform = 'translateY(-3px) scale(1.05)';
                        e.target.style.boxShadow = '0 8px 25px rgba(0, 0, 0, 0.4)';
                    }}
                    onMouseLeave={(e) => {
                        e.target.style.transform = 'translateY(0) scale(1)';
                        e.target.style.boxShadow = '0 4px 15px rgba(0, 0, 0, 0.3)';
                    }}
                >
                    ← Back to Game
                </button>
                <DesignShowcase />
            </div>
        );
    }

    return (
        <button
            onClick={() => setShowShowcase(true)}
            style={{
                position: 'fixed',
                bottom: '20px',
                right: '20px',
                zIndex: 1000,
                padding: '15px 30px',
                background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                color: 'white',
                border: 'none',
                borderRadius: '15px',
                fontSize: '1.1em',
                fontWeight: '700',
                cursor: 'pointer',
                boxShadow: '0 8px 25px rgba(102, 126, 234, 0.5)',
                transition: 'all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)',
                display: 'flex',
                alignItems: 'center',
                gap: '10px'
            }}
            onMouseEnter={(e) => {
                e.target.style.transform = 'translateY(-5px) scale(1.05)';
                e.target.style.boxShadow = '0 15px 40px rgba(102, 126, 234, 0.6)';
            }}
            onMouseLeave={(e) => {
                e.target.style.transform = 'translateY(0) scale(1)';
                e.target.style.boxShadow = '0 8px 25px rgba(102, 126, 234, 0.5)';
            }}
        >
            <span style={{ fontSize: '1.5em' }}>✨</span>
            View Design Showcase
        </button>
    );
}

export default ShowcaseButton;
