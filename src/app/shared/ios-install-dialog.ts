import { Component } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule } from '@angular/material/dialog';

/** Instrucciones para instalar en iPhone o iPad, donde Safari no tiene diálogo propio. */
@Component({
  imports: [MatButtonModule, MatDialogModule],
  selector: 'app-ios-install-dialog',
  template: `
    <h2 mat-dialog-title>Instalar en iPhone o iPad</h2>
    <mat-dialog-content>
      <ol>
        <li>Pulse el botón Compartir de Safari.</li>
        <li>Elija «Añadir a pantalla de inicio».</li>
        <li>Confirme con «Añadir».</li>
      </ol>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button matButton="filled" type="button" mat-dialog-close>Entendido</button>
    </mat-dialog-actions>
  `,
  styles: `
    ol {
      margin: 0;
      padding-left: 20px;
    }

    li + li {
      margin-top: 8px;
    }
  `,
})
export class IosInstallDialog {}
