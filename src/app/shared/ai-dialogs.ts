import { Component, inject, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import {
  MAT_DIALOG_DATA,
  MatDialog,
  MatDialogModule,
  MatDialogRef,
} from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { firstValueFrom } from 'rxjs';

// Diálogos para revisar lo que propone la inteligencia artificial antes de
// guardarlo: el modelo puede equivocarse, así que nada se añade al
// inventario sin que el usuario lo vea y lo acepte.

const DIALOG_WIDTH = 'min(520px, calc(100vw - 32px))';

/** Texto leído en una foto, editable antes de añadirlo a las notas. */
@Component({
  imports: [
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    ReactiveFormsModule,
  ],
  selector: 'app-ai-text-dialog',
  styles: `
    mat-form-field {
      width: 100%;
    }

    .hint {
      color: var(--mat-sys-on-surface-variant);
      margin: 0 0 12px;
    }
  `,
  template: `
    <h2 mat-dialog-title>Texto leído en la foto</h2>
    <mat-dialog-content>
      <p class="hint">Revíselo y corríjalo si hace falta: la lectura automática puede fallar.</p>
      <mat-form-field appearance="outline">
        <mat-label>Texto</mat-label>
        <textarea matInput rows="8" [formControl]="text"></textarea>
      </mat-form-field>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button matButton type="button" mat-dialog-close>Cancelar</button>
      <button matButton="filled" type="button" class="confirm" (click)="accept()">
        Añadir a las notas
      </button>
    </mat-dialog-actions>
  `,
})
export class AiTextDialog {
  private readonly ref = inject<MatDialogRef<AiTextDialog, string>>(MatDialogRef);
  protected readonly text = new FormControl(inject<string>(MAT_DIALOG_DATA), { nonNullable: true });

  protected accept(): void {
    const text = this.text.value.trim();
    if (text) this.ref.close(text);
  }
}

/** Muestra el texto leído y devuelve el que el usuario acepta, o `undefined` si cancela. */
export function reviewText(dialog: MatDialog, text: string): Promise<string | undefined> {
  const ref = dialog.open<AiTextDialog, string, string>(AiTextDialog, {
    data: text,
    width: DIALOG_WIDTH,
  });
  return firstValueFrom(ref.afterClosed());
}

export interface RecognizedItem {
  name: string;
  /** Ya hay en el contenedor algo con ese nombre. */
  existing: boolean;
}

export interface AiItemsData {
  container: string;
  items: RecognizedItem[];
}

/** Objetos reconocidos en la foto de un contenedor, para elegir cuáles añadir. */
@Component({
  imports: [MatButtonModule, MatCheckboxModule, MatDialogModule],
  selector: 'app-ai-items-dialog',
  styles: `
    .hint {
      color: var(--mat-sys-on-surface-variant);
      margin: 0 0 8px;
    }

    ul {
      list-style: none;
      margin: 0;
      padding: 0;
    }

    .existing {
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
      margin-left: 4px;
    }
  `,
  template: `
    <h2 mat-dialog-title>Objetos reconocidos</h2>
    <mat-dialog-content>
      <p class="hint">
        Elija cuáles añadir a «{{ data.container }}». El reconocimiento automático puede fallar o
        confundir objetos. Los que ya parecen estar en el contenedor aparecen sin marcar.
      </p>
      <ul>
        @for (item of data.items; track item.name; let index = $index) {
          <li>
            <mat-checkbox [checked]="chosen().has(index)" (change)="toggle(index, $event.checked)">
              {{ item.name }}
              @if (item.existing) {
                <span class="existing">(ya está)</span>
              }
            </mat-checkbox>
          </li>
        }
      </ul>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button matButton type="button" mat-dialog-close>Cancelar</button>
      <button
        matButton="filled"
        type="button"
        class="confirm"
        [disabled]="chosen().size === 0"
        (click)="accept()"
      >
        {{ chosen().size === 1 ? 'Añadir 1 objeto' : 'Añadir ' + chosen().size + ' objetos' }}
      </button>
    </mat-dialog-actions>
  `,
})
export class AiItemsDialog {
  protected readonly data = inject<AiItemsData>(MAT_DIALOG_DATA);
  private readonly ref = inject<MatDialogRef<AiItemsDialog, string[]>>(MatDialogRef);

  /** Posiciones marcadas; al abrir, las de lo que no está todavía en el contenedor. */
  protected readonly chosen = signal<ReadonlySet<number>>(
    new Set(this.data.items.flatMap((item, index) => (item.existing ? [] : [index]))),
  );

  protected toggle(index: number, checked: boolean): void {
    const next = new Set(this.chosen());
    if (checked) next.add(index);
    else next.delete(index);
    this.chosen.set(next);
  }

  protected accept(): void {
    this.ref.close(
      this.data.items.filter((_, index) => this.chosen().has(index)).map((i) => i.name),
    );
  }
}

/** Muestra los objetos reconocidos y devuelve los que el usuario elige, o `undefined` si cancela. */
export function chooseItems(dialog: MatDialog, data: AiItemsData): Promise<string[] | undefined> {
  const ref = dialog.open<AiItemsDialog, AiItemsData, string[]>(AiItemsDialog, {
    data,
    width: DIALOG_WIDTH,
  });
  return firstValueFrom(ref.afterClosed());
}
