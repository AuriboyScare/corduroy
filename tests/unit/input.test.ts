// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { Input } from '../../src/game/input';

const key = (type: 'keydown' | 'keyup', code: string) =>
  window.dispatchEvent(new KeyboardEvent(type, { code }));
const press = (code: string) => {
  key('keydown', code);
  key('keyup', code);
};

describe('Input', () => {
  it('ignores keys typed into a text field', () => {
    const input = new Input(document.createElement('canvas'));
    const field = document.createElement('input');
    document.body.appendChild(field);
    field.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyG', bubbles: true }));
    expect(input.wasPressed('KeyG')).toBe(false);
    field.remove();
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyG' }));
    expect(input.wasPressed('KeyG')).toBe(true);
  });

  it('keeps two presses that land in the same frame', () => {
    const input = new Input(document.createElement('canvas'));
    press('KeyC');
    press('KeyC');
    expect(input.wasPressed('KeyC')).toBe(true);
    expect(input.wasPressed('KeyC')).toBe(true);
    expect(input.wasPressed('KeyC')).toBe(false);
  });

  it('carries an unconsumed press of a listened-for key to the next frame', () => {
    const input = new Input(document.createElement('canvas'));
    press('KeyC');
    press('KeyC');
    expect(input.wasPressed('KeyC')).toBe(true);
    input.endFrame();
    expect(input.wasPressed('KeyC')).toBe(true);
    input.endFrame();
    expect(input.wasPressed('KeyC')).toBe(false);
  });

  it('drops presses of keys nobody asked about', () => {
    const input = new Input(document.createElement('canvas'));
    press('KeyT');
    input.endFrame();
    expect(input.wasPressed('KeyT')).toBe(false);
  });

  it('does not count key repeat as new presses', () => {
    const input = new Input(document.createElement('canvas'));
    key('keydown', 'KeyW');
    key('keydown', 'KeyW');
    key('keydown', 'KeyW');
    expect(input.held('KeyW')).toBe(true);
    expect(input.wasPressed('KeyW')).toBe(true);
    expect(input.wasPressed('KeyW')).toBe(false);
    key('keyup', 'KeyW');
    expect(input.held('KeyW')).toBe(false);
  });
});
