import { TableColumn, type MigrationInterface, type QueryRunner } from 'typeorm';
export class ReviewViewingBinding1792500001000 implements MigrationInterface {
  async up(q:QueryRunner) {await q.addColumn('movie_review',new TableColumn({name:'viewingEventId',type:'varchar',isNullable:true}));}
  async down(q:QueryRunner) {await q.dropColumn('movie_review','viewingEventId');}
}
