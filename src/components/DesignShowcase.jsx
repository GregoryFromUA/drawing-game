import { useState } from 'react';
import '../styles/showcase.css';

function DesignShowcase() {
    const [activeDemo, setActiveDemo] = useState('buttons');

    return (
        <div className="showcase-container">
            <div className="showcase-content">
                <header className="showcase-header">
                    <h1 className="showcase-title">
                        ✨ Modern Design Showcase ✨
                    </h1>
                    <p className="showcase-subtitle">
                        Experience the stunning visual transformation
                    </p>
                </header>

                <div className="demo-tabs">
                    <button
                        className={`demo-tab ${activeDemo === 'buttons' ? 'active' : ''}`}
                        onClick={() => setActiveDemo('buttons')}
                    >
                        🎨 Buttons
                    </button>
                    <button
                        className={`demo-tab ${activeDemo === 'cards' ? 'active' : ''}`}
                        onClick={() => setActiveDemo('cards')}
                    >
                        🃏 Cards
                    </button>
                    <button
                        className={`demo-tab ${activeDemo === 'effects' ? 'active' : ''}`}
                        onClick={() => setActiveDemo('effects')}
                    >
                        ✨ Effects
                    </button>
                </div>

                <div className="demo-content">
                    {activeDemo === 'buttons' && (
                        <div className="demo-section">
                            <h2>✨ Modern Button Styles</h2>
                            <div className="button-grid">
                                <button className="btn btn-primary">Primary Action</button>
                                <button className="btn btn-success">Success</button>
                                <button className="btn btn-danger">Danger</button>
                                <button className="btn btn-secondary">Secondary</button>
                            </div>
                            <p className="demo-description">
                                Featuring gradient backgrounds, smooth hover effects, and ripple animations
                            </p>
                        </div>
                    )}

                    {activeDemo === 'cards' && (
                        <div className="demo-section">
                            <h2>🃏 Interactive Card Designs</h2>
                            <div className="cards-grid">
                                <div className="demo-card">
                                    <div className="demo-card-header">Glassmorphism</div>
                                    <div className="demo-card-body">
                                        Beautiful frosted glass effect with backdrop blur
                                    </div>
                                </div>
                                <div className="demo-card demo-card-glow">
                                    <div className="demo-card-header">Glowing Effects</div>
                                    <div className="demo-card-body">
                                        Pulsing glow animations for emphasis
                                    </div>
                                </div>
                                <div className="demo-card demo-card-gradient">
                                    <div className="demo-card-header">Gradient Magic</div>
                                    <div className="demo-card-body">
                                        Smooth color transitions and depth
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {activeDemo === 'effects' && (
                        <div className="demo-section">
                            <h2>✨ Visual Effects Showcase</h2>

                            <div className="effect-demo">
                                <h3>Shimmer Effect</h3>
                                <div className="shimmer-box">
                                    <span>Hover to see shimmer</span>
                                </div>
                            </div>

                            <div className="effect-demo">
                                <h3>Float Animation</h3>
                                <div className="float-box">
                                    <span>🎈 Floating Element</span>
                                </div>
                            </div>

                            <div className="effect-demo">
                                <h3>Pulse Animation</h3>
                                <div className="pulse-box">
                                    <span>💓 Pulsing Heart</span>
                                </div>
                            </div>

                            <div className="effect-demo">
                                <h3>Interactive States</h3>
                                <div className="state-demos">
                                    <div className="state-box state-correct">✓ Correct</div>
                                    <div className="state-box state-incorrect">✗ Incorrect</div>
                                    <div className="state-box state-pending">⏳ Pending</div>
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                <div className="showcase-features">
                    <h2>🎯 Design Features</h2>
                    <div className="features-grid">
                        <div className="feature-item">
                            <div className="feature-icon">🎨</div>
                            <h3>Modern Gradients</h3>
                            <p>Beautiful color transitions throughout</p>
                        </div>
                        <div className="feature-item">
                            <div className="feature-icon">✨</div>
                            <h3>Smooth Animations</h3>
                            <p>Butter-smooth 60fps transitions</p>
                        </div>
                        <div className="feature-item">
                            <div className="feature-icon">💎</div>
                            <h3>Glassmorphism</h3>
                            <p>Frosted glass UI elements</p>
                        </div>
                        <div className="feature-item">
                            <div className="feature-icon">🌈</div>
                            <h3>Color Theory</h3>
                            <p>Professional color palette</p>
                        </div>
                        <div className="feature-item">
                            <div className="feature-icon">⚡</div>
                            <h3>Performance</h3>
                            <p>Optimized CSS animations</p>
                        </div>
                        <div className="feature-item">
                            <div className="feature-icon">📱</div>
                            <h3>Responsive</h3>
                            <p>Works on all devices</p>
                        </div>
                    </div>
                </div>

                <footer className="showcase-footer">
                    <p>Built with ❤️ using modern CSS techniques</p>
                    <p className="tech-stack">
                        Glassmorphism • CSS Animations • Backdrop Filters • Gradients • Shadows
                    </p>
                </footer>
            </div>
        </div>
    );
}

export default DesignShowcase;
