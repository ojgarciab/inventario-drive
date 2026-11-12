import { Component, inject } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { TYPE_ICONS } from './type-icons';

export interface TypeDialogData {
  title: string;
  name: string;
  icon: string;
}

export interface TypeDialogResult {
  name: string;
  icon: string;
}

/** Nombre e icono de un tipo de contenedor. */
@Component({
  imports: [
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    ReactiveFormsModule,
  ],
  selector: 'app-type-dialog',
  styles: `
    mat-dialog-content {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding-top: 8px !important;
    }

    .option {
      align-items: center;
      display: flex;
      gap: 12px;
    }
  `,
  template: `
    <h2 mat-dialog-title>{{ data.title }}</h2>
    <form [formGroup]="form" (ngSubmit)="save()">
      <mat-dialog-content>
        <mat-form-field appearance="outline">
          <mat-label>Nombre</mat-label>
          <input matInput formControlName="name" autocomplete="off" maxlength="60" />
          @if (form.controls.name.invalid) {
            <mat-error>Escriba un nombre.</mat-error>
          }
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>Icono</mat-label>
          <mat-select formControlName="icon">
            <mat-select-trigger>
              <span class="option">
                <mat-icon aria-hidden="true">{{ form.controls.icon.value }}</mat-icon>
                {{ label(form.controls.icon.value) }}
              </span>
            </mat-select-trigger>
            @for (option of icons; track option.icon) {
              <mat-option [value]="option.icon">
                <mat-icon aria-hidden="true">{{ option.icon }}</mat-icon>
                {{ option.label }}
              </mat-option>
            }
          </mat-select>
        </mat-form-field>
      </mat-dialog-content>
      <mat-dialog-actions align="end">
        <button matButton type="button" mat-dialog-close>Cancelar</button>
        <button matButton="filled" type="submit" class="confirm">Guardar</button>
      </mat-dialog-actions>
    </form>
  `,
})
export class TypeDialog {
  protected readonly data = inject<TypeDialogData>(MAT_DIALOG_DATA);
  private readonly ref = inject<MatDialogRef<TypeDialog, TypeDialogResult>>(MatDialogRef);

  /** Se conserva el icono actual aunque no esté en la lista de sugeridos. */
  protected readonly icons = TYPE_ICONS.some((option) => option.icon === this.data.icon)
    ? TYPE_ICONS
    : [{ icon: this.data.icon, label: 'Actual' }, ...TYPE_ICONS];

  protected readonly form = new FormGroup({
    name: new FormControl(this.data.name, {
      nonNullable: true,
      validators: [Validators.required, Validators.pattern(/\S/)],
    }),
    icon: new FormControl(this.data.icon, { nonNullable: true }),
  });

  protected label(icon: string): string {
    return this.icons.find((option) => option.icon === icon)?.label ?? '';
  }

  protected save(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const { name, icon } = this.form.getRawValue();
    this.ref.close({ name: name.trim(), icon });
  }
}
